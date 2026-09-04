using GospelPresenter.Web.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GospelPresenter.Web.Sync;

/// <summary>
/// The doorbell a signed-in device holds open: the server rings it when the device's organisation
/// changes, and the device answers by syncing over HTTP as it always has.
///
/// Deliberately empty of methods. A device has nothing to say here — everything it sends goes
/// through the sync endpoints — and a hub with nothing callable cannot be asked for anything by a
/// client that should not be asking.
///
/// Separate from <c>LiveSessionHub</c> rather than a method on it, because the lifetimes have
/// nothing in common: that one is open only while something is being presented and is scoped to one
/// session, this one is open for as long as the device is signed in and is scoped to an organisation.
///
/// Device tokens only. A browser needs no socket for this: its circuits run in this process and
/// subscribe to the notifier directly.
/// </summary>
[Authorize(AuthenticationSchemes = DeviceTokenAuthenticationHandler.SchemeName)]
public class OrganizationChangesHub(
    OrganizationChangeConnectionRegistry registry,
    ILogger<OrganizationChangesHub> logger) : Hub
{
    /// <summary>
    /// One group per organisation. Everything that decides what a connection may hear is read from
    /// the token, never from anything the client sends.
    /// </summary>
    public static string GroupFor(string organizationId) => $"org:{organizationId}";

    public override async Task OnConnectedAsync()
    {
        var organizationId = Context.User?.FindFirst("organization_id")?.Value;
        var deviceId = Context.User?.FindFirst("device_id")?.Value;

        if (organizationId is null || deviceId is null)
        {
            // A device token without the claims this needs — one issued before device_id existed
            // would look like this. Nothing to do but refuse: a connection with no organisation
            // has no group to be in.
            logger.LogWarning("A change-hub connection arrived without an organisation or device id");
            Context.Abort();
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(organizationId));
        registry.Register(deviceId, Context.ConnectionId);

        await base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        // The group membership goes with the connection; only the device map is ours to clean up.
        registry.Forget(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
