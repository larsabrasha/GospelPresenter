using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IRemoteDisplayService
{
    Task<List<RemoteDisplay>> GetDisplaysAsync(string organizationId, CallerContext caller);
    Task<RemoteDisplay> AddDisplayAsync(string organizationId, string displayIdentifier, string name, CallerContext caller);
    Task RemoveDisplayAsync(string organizationId, string id, CallerContext caller);
    Task UpdateDisplayAsync(string organizationId, string id, string name, CallerContext caller);
}

public class RemoteDisplayService(
    IDbContextFactory<PresentationContext> dbContextFactory) : IRemoteDisplayService
{
    public async Task<List<RemoteDisplay>> GetDisplaysAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.RemoteDisplays
            .Where(d => d.OrganizationId == organizationId)
            .OrderBy(d => d.CreatedAt)
            .ToListAsync();
    }

    public async Task<RemoteDisplay> AddDisplayAsync(string organizationId, string displayIdentifier, string name, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var display = new RemoteDisplay
        {
            OrganizationId = organizationId,
            DisplayIdentifier = displayIdentifier,
            Name = name,
            CreatedAt = DateTimeOffset.UtcNow
        };

        context.RemoteDisplays.Add(display);
        await context.SaveChangesAsync();
        return display;
    }

    public async Task RemoveDisplayAsync(string organizationId, string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.RemoteDisplays
            .Where(d => d.Id == id && d.OrganizationId == organizationId)
            .ExecuteDeleteAsync();
    }

    public async Task UpdateDisplayAsync(string organizationId, string id, string name, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.RemoteDisplays
            .Where(d => d.Id == id && d.OrganizationId == organizationId)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.Name, name));
    }

}
