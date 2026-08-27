using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IOrganizationImageService
{
    Task<List<OrganizationImage>> GetImagesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OrganizationImage?> GetImageByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OrganizationImage> AddImageAsync(string organizationId, string fileName, string contentType, byte[] thumbnailData, byte[] fullData, CallerContext caller, CancellationToken cancellationToken = default);
    Task DeleteImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
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
            context.OrganizationImages.Where(x => x.OrganizationId == organizationId),
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

        // Tracked delete rather than ExecuteDelete, so the context writes the tombstone itself.
        var image = await context.OrganizationImages
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);
        if (image is null) return;

        context.OrganizationImages.Remove(image);
        await context.SaveChangesAsync(cancellationToken);

        await storage.DeleteByPrefixAsync(ImageUrlHelper.OrgImagePrefix(organizationId, id), cancellationToken);
    }
}
