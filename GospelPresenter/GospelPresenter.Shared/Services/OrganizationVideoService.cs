using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IOrganizationVideoService
{
    Task<List<OrganizationVideo>> GetVideosAsync(string organizationId, CancellationToken cancellationToken = default);
    Task<OrganizationVideo> AddVideoAsync(string organizationId, string youtubeVideoId, string title, CancellationToken cancellationToken = default);
    Task DeleteVideoAsync(string id, CancellationToken cancellationToken = default);
}

public class OrganizationVideoService(IDbContextFactory<PresentationContext> dbContextFactory) : IOrganizationVideoService
{
    public async Task<List<OrganizationVideo>> GetVideosAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.OrganizationVideos
            .Where(x => x.OrganizationId == organizationId)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task<OrganizationVideo> AddVideoAsync(string organizationId, string youtubeVideoId, string title, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var video = new OrganizationVideo
        {
            YoutubeVideoId = youtubeVideoId,
            Title = title,
            OrganizationId = organizationId
        };

        context.OrganizationVideos.Add(video);
        await context.SaveChangesAsync(cancellationToken);

        return video;
    }

    public async Task DeleteVideoAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.OrganizationVideos
            .Where(x => x.Id == id)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
