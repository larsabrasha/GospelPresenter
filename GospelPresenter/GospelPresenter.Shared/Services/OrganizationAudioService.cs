using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IOrganizationAudioService
{
    Task<List<OrganizationAudio>> GetAudiosAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OrganizationAudio?> GetAudioByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OrganizationAudio> AddAudioAsync(string organizationId, string fileName, string contentType, byte[] data, CallerContext caller, CancellationToken cancellationToken = default);
    Task DeleteAudioAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
}

public class OrganizationAudioService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    IObjectStorageService storage) : IOrganizationAudioService
{
    public async Task<List<OrganizationAudio>> GetAudiosAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOrganizationAudios);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.OrganizationAudios
            .Where(x => x.OrganizationId == organizationId)
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => new OrganizationAudio
            {
                Id = x.Id,
                FileName = x.FileName,
                ContentType = x.ContentType,
                CreatedAt = x.CreatedAt,
                OrganizationId = x.OrganizationId
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<OrganizationAudio?> GetAudioByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOrganizationAudios);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.OrganizationAudios
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);
    }

    public async Task<OrganizationAudio> AddAudioAsync(string organizationId, string fileName, string contentType, byte[] data, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationAudios);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var audio = new OrganizationAudio
        {
            FileName = fileName,
            ContentType = contentType,
            OrganizationId = organizationId
        };

        await storage.UploadAsync(ImageUrlHelper.OrgAudioKey(organizationId, audio.Id), data, contentType, cancellationToken);

        try
        {
            context.OrganizationAudios.Add(audio);
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception)
        {
            await storage.DeleteByPrefixAsync(ImageUrlHelper.OrgAudioPrefix(organizationId, audio.Id), cancellationToken);
            throw;
        }

        return audio;
    }

    public async Task DeleteAudioAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOrganizationAudios);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.OrganizationAudios
            .Where(x => x.Id == id && x.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        await storage.DeleteByPrefixAsync(ImageUrlHelper.OrgAudioPrefix(organizationId, id), cancellationToken);
    }
}
