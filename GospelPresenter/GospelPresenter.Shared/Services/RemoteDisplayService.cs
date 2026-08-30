using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IRemoteDisplayService
{
    Task<List<RemoteDisplay>> GetDisplaysAsync(string organizationId, CallerContext caller);

    Task<RemoteDisplay> AddDisplayAsync(string organizationId, string name, CallerContext caller,
        OutputKind kind = OutputKind.Screen);

    Task RemoveDisplayAsync(string organizationId, string id, CallerContext caller);
    Task UpdateDisplayAsync(string organizationId, string id, string name, CallerContext caller);

    /// <summary>
    /// Replaces the public identifier of an output. Used when a public QR code has been shared
    /// somewhere it does not belong — the only remedy available, since printed signs cannot be
    /// recalled. Returns the new identifier, or null if the output does not exist.
    /// </summary>
    Task<string?> RegenerateIdentifierAsync(string organizationId, string id, CallerContext caller);

    /// <summary>
    /// Resolves a public output by its identifier without any permission check. Used by the
    /// anonymous watch endpoints, which only ever get the identifier from the visitor's URL.
    /// </summary>
    Task<RemoteDisplay?> FindPublicOutputAsync(string displayIdentifier);
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

    public async Task<RemoteDisplay> AddDisplayAsync(string organizationId, string name, CallerContext caller,
        OutputKind kind = OutputKind.Screen)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        await ValidationHelper.RequireMaxCountAsync(
            context.RemoteDisplays.Where(d => d.OrganizationId == organizationId),
            AppConstraints.MaxRemoteDisplaysPerOrg, "outputs", CancellationToken.None);

        for (var attempt = 0; attempt < DisplayIdentifiers.MaxRetries; attempt++)
        {
            var display = new RemoteDisplay
            {
                OrganizationId = organizationId,
                DisplayIdentifier = DisplayIdentifiers.Generate(),
                Name = name,
                Kind = kind,
                CreatedAt = DateTimeOffset.UtcNow
            };

            context.RemoteDisplays.Add(display);
            try
            {
                await context.SaveChangesAsync();
                return display;
            }
            catch (DbUpdateException) when (attempt < DisplayIdentifiers.MaxRetries - 1)
            {
                // Unique-index collision on DisplayIdentifier — discard the entry and retry.
                context.RemoteDisplays.Remove(display);
            }
        }

        throw DisplayIdentifiers.Exhausted();
    }

    public async Task RemoveDisplayAsync(string organizationId, string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        // A tracked delete rather than ExecuteDeleteAsync, so the save writes the tombstone: an
        // output removed here has to disappear from the devices that pulled it, and a delete no
        // client can ever learn about would leave a dead QR code live on every one of them.
        var display = await context.RemoteDisplays
            .FirstOrDefaultAsync(d => d.Id == id && d.OrganizationId == organizationId);
        if (display is null)
            return;

        context.RemoteDisplays.Remove(display);
        await context.SaveChangesAsync();
    }

    public async Task UpdateDisplayAsync(string organizationId, string id, string name, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.RemoteDisplays
            .Where(d => d.Id == id && d.OrganizationId == organizationId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(d => d.Name, name)
                .SetProperty(d => d.ModifiedAt, DateTimeOffset.UtcNow));
    }

    public async Task<string?> RegenerateIdentifierAsync(string organizationId, string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var display = await context.RemoteDisplays
            .FirstOrDefaultAsync(d => d.Id == id && d.OrganizationId == organizationId);
        if (display is null)
            return null;

        for (var attempt = 0; attempt < DisplayIdentifiers.MaxRetries; attempt++)
        {
            display.DisplayIdentifier = DisplayIdentifiers.Generate();
            try
            {
                await context.SaveChangesAsync();
                return display.DisplayIdentifier;
            }
            catch (DbUpdateException) when (attempt < DisplayIdentifiers.MaxRetries - 1)
            {
                // Unique-index collision on DisplayIdentifier — try another identifier.
            }
        }

        throw DisplayIdentifiers.Exhausted();
    }

    public async Task<RemoteDisplay?> FindPublicOutputAsync(string displayIdentifier)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.RemoteDisplays
            .Include(d => d.Organization)
            .FirstOrDefaultAsync(d =>
                d.DisplayIdentifier == displayIdentifier && d.Kind == OutputKind.PublicQr);
    }
}
