using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using GospelPresenter.Shared.Contexts;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Web.Services;

/// <summary>
/// Creates the SQLite mock database used when no real connection string is configured, and
/// rebuilds it from scratch whenever the model has changed since it was created.
///
/// Mock mode uses EnsureCreated rather than migrations, because the migrations are written for
/// Npgsql and their SQL does not all apply to SQLite. EnsureCreated does nothing at all when the
/// file already exists, so before this a model change left developers with a database missing the
/// new columns and a runtime error such as "no such column: r.Kind" — with no hint that the fix
/// was to delete the file.
///
/// The database is disposable scratch data that is reseeded on creation, so recreating it is the
/// right response to a schema change. NEVER call this for a real database.
/// </summary>
public static class MockDatabaseInitializer
{
    private const string SchemaTable = "__MockSchema";

    public static async Task InitializeAsync(
        IDbContextFactory<PresentationContext> dbContextFactory, ILogger logger)
    {
        string fingerprint;

        // The connection is never held open across the delete: EF opens and closes it around
        // each call below. A connection left open would keep the deleted file alive behind the
        // scenes, and the schema EF then sees stops matching what is on disk.
        await using (var probe = await dbContextFactory.CreateDbContextAsync())
        {
            fingerprint = ComputeSchemaFingerprint(probe);

            if (await probe.Database.CanConnectAsync())
            {
                var existing = await ReadFingerprintAsync(probe);
                if (existing != fingerprint)
                {
                    logger.LogWarning(
                        "Mock database schema is out of date (found {Existing}, expected {Expected}) — recreating and reseeding it.",
                        existing ?? "no fingerprint", fingerprint);

                    await DeleteDatabaseAsync(probe, logger);
                }
            }
        }

        // A fresh context, so nothing about the deleted database is carried over.
        await using var db = await dbContextFactory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();
        await WriteFingerprintAsync(db, fingerprint);
        await MockDataSeeder.SeedAsync(db);
    }

    /// <summary>
    /// A hash of the schema EnsureCreated would produce for the current model. Any added,
    /// removed or altered table, column or index changes it.
    /// </summary>
    private static string ComputeSchemaFingerprint(PresentationContext db)
    {
        var script = db.Database.GenerateCreateScript();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(script));
        return Convert.ToHexString(hash)[..16];
    }

    private static async Task<string?> ReadFingerprintAsync(PresentationContext db)
    {
        try
        {
            // EF requires the column of a scalar SqlQueryRaw result to be named "Value".
            return await db.Database
                .SqlQueryRaw<string>($"SELECT Fingerprint AS Value FROM {SchemaTable} LIMIT 1")
                .FirstOrDefaultAsync();
        }
        catch (DbException)
        {
            // No such table: a database created before fingerprinting existed. Treat it as
            // out of date, which it may well be.
            return null;
        }
    }

    private static async Task WriteFingerprintAsync(PresentationContext db, string fingerprint)
    {
        await db.Database.ExecuteSqlRawAsync(
            $"CREATE TABLE IF NOT EXISTS {SchemaTable} (Fingerprint TEXT NOT NULL)");
        await db.Database.ExecuteSqlRawAsync($"DELETE FROM {SchemaTable}");
        await db.Database.ExecuteSqlRawAsync(
            $"INSERT INTO {SchemaTable} (Fingerprint) VALUES ({{0}})", fingerprint);
    }

    private static async Task DeleteDatabaseAsync(PresentationContext db, ILogger logger)
    {
        // Captured before deleting, while the connection still knows where the file lives.
        var dataSource = db.Database.GetDbConnection().DataSource;

        await db.Database.EnsureDeletedAsync();

        // EnsureDeleted removes the database file itself but leaves SQLite's write-ahead log
        // beside it. A stale log next to a brand new database is discarded by SQLite, but
        // removing it keeps the directory honest about what exists.
        if (string.IsNullOrEmpty(dataSource))
            return;

        foreach (var suffix in (string[])["-wal", "-shm"])
        {
            try
            {
                File.Delete(dataSource + suffix);
            }
            catch (IOException ex)
            {
                logger.LogDebug(ex, "Could not remove {File}", dataSource + suffix);
            }
        }
    }
}
