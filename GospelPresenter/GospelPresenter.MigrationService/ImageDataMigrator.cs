using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using static GospelPresenter.Shared.Services.ImageUrlHelper;

namespace GospelPresenter.MigrationService;

/// <summary>
/// Migrates image binary data from PostgreSQL to S3.
/// Safe to re-run: S3 PutObject is idempotent (overwrites existing keys),
/// so a restart after partial failure simply re-uploads already-migrated images.
/// </summary>
internal class ImageDataMigrator(ILogger<ImageDataMigrator> logger)
{
    private const int MaxParallelUploads = 8;

    public async Task MigrateAsync(IObjectStorageService storage, PresentationContext context, CancellationToken ct)
    {
        var connection = context.Database.GetDbConnection();
        await connection.OpenAsync(ct);

        try
        {
            if (!await ColumnExists(connection, "OrganizationImages", "FullData", ct))
            {
                logger.LogInformation("Image columns already removed — data migration already completed");
                return;
            }

            await MigrateOrganizationImages(storage, connection, ct);
            await MigrateOverlaySlides(storage, connection, ct);
        }
        finally
        {
            await connection.CloseAsync();
        }
    }

    private async Task MigrateOrganizationImages(IObjectStorageService storage, System.Data.Common.DbConnection connection, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """SELECT "Id", "OrganizationId", "ContentType", "ThumbnailData", "FullData" FROM "OrganizationImages" WHERE "FullData" IS NOT NULL""";
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var rows = new List<(string Id, string OrgId, string ContentType, byte[]? Thumb, byte[]? Full)>();
        while (await reader.ReadAsync(ct))
        {
            rows.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2), reader[3] as byte[], reader[4] as byte[]));
        }

        await Parallel.ForEachAsync(rows, new ParallelOptions { MaxDegreeOfParallelism = MaxParallelUploads, CancellationToken = ct }, async (row, token) =>
        {
            var tasks = new List<Task>(2);
            if (row.Full is not null)
                tasks.Add(storage.UploadAsync(OrgImageKey(row.OrgId, row.Id, "full"), row.Full, row.ContentType, token));
            if (row.Thumb is not null)
                tasks.Add(storage.UploadAsync(OrgImageKey(row.OrgId, row.Id, "thumb"), row.Thumb, row.ContentType, token));
            await Task.WhenAll(tasks);
        });

        logger.LogInformation("Migrated {Count} organization images to S3", rows.Count);
    }

    private async Task MigrateOverlaySlides(IObjectStorageService storage, System.Data.Common.DbConnection connection, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """SELECT "Id", "OrganizationId", "ImageData" FROM "OverlaySlides" WHERE "ImageData" IS NOT NULL""";
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var rows = new List<(string Id, string OrgId, byte[] Data)>();
        while (await reader.ReadAsync(ct))
        {
            var imageData = reader[2] as byte[];
            if (imageData is not null)
                rows.Add((reader.GetString(0), reader.GetString(1), imageData));
        }

        await Parallel.ForEachAsync(rows, new ParallelOptions { MaxDegreeOfParallelism = MaxParallelUploads, CancellationToken = ct }, async (row, token) =>
        {
            await storage.UploadAsync(OverlayImageKey(row.OrgId, row.Id), row.Data, "image/png", token);
        });

        logger.LogInformation("Migrated {Count} overlay images to S3", rows.Count);
    }

    private static async Task<bool> ColumnExists(System.Data.Common.DbConnection connection, string table, string column, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name = @table AND column_name = @column
            """;
        var tableParam = cmd.CreateParameter();
        tableParam.ParameterName = "@table";
        tableParam.Value = table;
        cmd.Parameters.Add(tableParam);
        var columnParam = cmd.CreateParameter();
        columnParam.ParameterName = "@column";
        columnParam.Value = column;
        cmd.Parameters.Add(columnParam);
        var result = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt64(result) > 0;
    }
}
