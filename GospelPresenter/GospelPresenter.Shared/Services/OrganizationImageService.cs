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

public class OrganizationImageService(IDbContextFactory<PresentationContext> dbContextFactory) : IOrganizationImageService
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
                ThumbnailData = x.ThumbnailData,
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
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var image = new OrganizationImage
        {
            FileName = fileName,
            ThumbnailData = thumbnailData,
            FullData = fullData,
            ContentType = contentType,
            OrganizationId = organizationId
        };

        context.OrganizationImages.Add(image);
        await context.SaveChangesAsync(cancellationToken);

        return image;
    }

    public async Task DeleteImageAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.OrganizationImages
            .Where(x => x.Id == id && x.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
