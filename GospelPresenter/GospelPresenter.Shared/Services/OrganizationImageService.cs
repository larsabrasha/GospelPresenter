using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IOrganizationImageService
{
    Task<List<OrganizationImage>> GetImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OrganizationImage?> GetImageByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OrganizationImage> AddImageAsync(string organizationId, string fileName, string contentType, byte[] thumbnailData, byte[] fullData, CallerContext caller, CancellationToken cancellationToken = default);
    /// <summary>Moves the file to the trash. Reversible until it is purged.</summary>
    Task DeleteImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>The organisation's trashed files, newest first. Purges what has expired first.</summary>
    Task<IList<TrashedImage>> GetTrashedImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task RestoreImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task PermanentlyDeleteImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task EmptyImageTrashAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>Purges what has been in the trash past the retention window. Safe to call at any time.</summary>
    Task PurgeExpiredImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
}

public class OrganizationImageService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    IObjectStorageService storage) : IOrganizationImageService
{
    public async Task<List<OrganizationImage>> GetImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.OrganizationImages
            .NotDeleted()
            .Where(x => x.OrganizationId == organizationId)
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => new OrganizationImage
            {
                Id = x.Id,
                FileName = x.FileName,
                ContentType = x.ContentType,
                CreatedAt = x.CreatedAt,
                OrganizationId = x.OrganizationId
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<OrganizationImage?> GetImageByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Deliberately unfiltered. This is the lookup behind the media endpoint, and a file in the
        // trash must keep being served: a presentation that already uses it would otherwise break
        // mid-service. The bytes survive until the purge, so serving them is always possible.
        return await context.OrganizationImages
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);
    }

    public async Task<OrganizationImage> AddImageAsync(string organizationId, string fileName, string contentType, byte[] thumbnailData, byte[] fullData, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(fileName, AppConstraints.FileNameMaxLength, "FileName");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await ValidationHelper.RequireMaxCountAsync(
            context.OrganizationImages.NotDeleted().Where(x => x.OrganizationId == organizationId),
            AppConstraints.MaxImagesPerOrg, "images", cancellationToken);

        var image = new OrganizationImage
        {
            FileName = fileName,
            ContentType = contentType,
            OrganizationId = organizationId
        };

        await Task.WhenAll(
            storage.UploadAsync(ImageUrlHelper.OrgImageKey(organizationId, image.Id, "full"), fullData, contentType, cancellationToken),
            storage.UploadAsync(ImageUrlHelper.OrgImageKey(organizationId, image.Id, "thumb"), thumbnailData, contentType, cancellationToken));

        try
        {
            context.OrganizationImages.Add(image);
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception)
        {
            await storage.DeleteByPrefixAsync(ImageUrlHelper.OrgImagePrefix(organizationId, image.Id), cancellationToken);
            throw;
        }

        return image;
    }

    public async Task DeleteImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // A tracked update, so the save stamps ModifiedAt and announces the change by itself. No
        // tombstone and no storage delete: the row and its bytes are still there, and DeletedAt
        // travels to clients as an ordinary column so every device shows the same trash.
        var row = await context.OrganizationImages
            .NotDeleted()
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);
        if (row is null) return;

        row.DeletedAt = DateTimeOffset.UtcNow;
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IList<TrashedImage>> GetTrashedImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        return await TrashQuery(context, organizationId)
            .Select(x => new TrashedImage(x.Id, x.FileName, x.ContentType, x.DeletedAt!.Value))
            .ToListAsync(cancellationToken);
    }

    public async Task RestoreImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var row = await context.OrganizationImages
            .OnlyDeleted()
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);
        if (row is null) return;

        // Restoring can carry the organisation past its quota — it was under it when the file was
        // trashed, and refusing here would strand the file with nowhere to go.
        row.DeletedAt = null;
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task PermanentlyDeleteImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var rows = await TrashQuery(context, organizationId)
            .Where(x => x.Id == id)
            .ToListAsync(cancellationToken);

        await PurgeAsync(context, organizationId, rows, cancellationToken);
    }

    public async Task EmptyImageTrashAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var rows = await TrashQuery(context, organizationId).ToListAsync(cancellationToken);

        await PurgeAsync(context, organizationId, rows, cancellationToken);
    }

    public async Task PurgeExpiredImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var cutoff = DateTimeOffset.UtcNow.AddDays(-AppConstraints.TrashRetentionDays);
        var expired = await TrashQuery(context, organizationId)
            .Where(x => x.DeletedAt < cutoff)
            .ToListAsync(cancellationToken);

        await PurgeAsync(context, organizationId, expired, cancellationToken);
    }

    /// <summary>
    /// Deletes files for good: rows, tombstones and the bytes behind them. This is what
    /// <c>DeleteImageAsync</c> used to do on the user's first click, and the only place that still
    /// does it — the caller has already checked that every row is in the trash.
    ///
    /// A tracked delete rather than ExecuteDelete, so the context writes the tombstones itself.
    /// Storage is cleared after the save: a file left behind by a crash between the two is waste,
    /// whereas a row pointing at bytes that are already gone is a broken image.
    /// </summary>
    private async Task PurgeAsync(PresentationContext context, string organizationId, List<OrganizationImage> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0) return;

        context.OrganizationImages.RemoveRange(rows);
        await context.SaveChangesAsync(cancellationToken);

        foreach (var row in rows)
            await storage.DeleteByPrefixAsync(ImageUrlHelper.OrgImagePrefix(organizationId, row.Id), cancellationToken);
    }

    /// <summary>One organisation's trash, newest first.</summary>
    private static IQueryable<OrganizationImage> TrashQuery(PresentationContext context, string organizationId) =>
        context.OrganizationImages
            .OnlyDeleted()
            .Where(x => x.OrganizationId == organizationId)
            .OrderByDescending(x => x.DeletedAt);
}

/// <summary>A file in the trash, and how long it has left there.</summary>
public record TrashedImage(string Id, string FileName, string ContentType, DateTimeOffset DeletedAt)
{
    public int DaysRemaining =>
        Math.Max(0, AppConstraints.TrashRetentionDays - (int)(DateTimeOffset.UtcNow - DeletedAt).TotalDays);
}
