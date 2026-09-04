using GospelPresenter.Shared.Sync;
using Microsoft.AspNetCore.SignalR;

namespace GospelPresenter.Web.Sync;

/// <summary>
/// Carries announcements from the notifier out to the devices on the hub.
///
/// A hosted service so the subscription has an obvious start and end, and so nothing has to resolve
/// it lazily to make it exist. Sending is fire-and-forget: an announcement is a hint that costs a
/// device one sync, and a slow or dead socket must never be allowed to hold up the save that
/// produced it — the five-minute idle pull is what makes that safe.
/// </summary>
public class OrganizationChangeBroadcaster(
    IOrganizationChangeNotifier notifier,
    IHubContext<OrganizationChangesHub> hub,
    OrganizationChangeConnectionRegistry registry,
    ILogger<OrganizationChangeBroadcaster> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        notifier.Announced += OnAnnounced;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        notifier.Announced -= OnAnnounced;
        return Task.CompletedTask;
    }

    private void OnAnnounced(OrganizationChange change)
    {
        var excluded = registry.ConnectionsFor(change.SourceDeviceId);
        var target = Target(change.OrganizationId, excluded);

        _ = SendAsync(target, change);
    }

    private IClientProxy Target(string? organizationId, IReadOnlyList<string> excluded)
    {
        if (organizationId is null)
        {
            // The organisation could not be derived from the change — a built-in theme, a user
            // setting. Everyone pulls; almost all of them will find nothing, which is cheaper than
            // the alternative of somebody never finding out.
            return excluded.Count == 0
                ? hub.Clients.All
                : hub.Clients.AllExcept(excluded);
        }

        var group = OrganizationChangesHub.GroupFor(organizationId);
        return excluded.Count == 0
            ? hub.Clients.Group(group)
            : hub.Clients.GroupExcept(group, excluded);
    }

    private async Task SendAsync(IClientProxy target, OrganizationChange change)
    {
        try
        {
            await target.SendAsync(OrganizationChangesHubMethods.OrganizationChanged);
        }
        catch (Exception e)
        {
            logger.LogDebug(e,
                "Could not announce a change for organisation {OrganizationId}",
                change.OrganizationId ?? "(all)");
        }
    }
}
