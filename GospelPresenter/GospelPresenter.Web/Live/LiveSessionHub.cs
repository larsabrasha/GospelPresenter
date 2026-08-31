using System.Security.Claims;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Web.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GospelPresenter.Web.Live;

/// <summary>
/// How a desktop client keeps this server's picture of its live presentation current, and how a
/// controller reaches back to it.
///
/// Device tokens only: a browser already presents through its own circuit and has no use for this.
/// Everything that decides what the connection may touch — which session, which organisation — is
/// read from the token, never from what the client sends. A client can therefore only ever mirror
/// the one session that belongs to the device it signed in as.
/// </summary>
[Authorize(AuthenticationSchemes = DeviceTokenAuthenticationHandler.SchemeName)]
public class LiveSessionHub(
    MirroredSessionRegistry registry,
    MirroredSessionProjector projector,
    ILogger<LiveSessionHub> logger) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var identity = ResolveIdentity();
        if (identity is null)
        {
            // A device token without the claims this needs — a token issued before device_id
            // existed would look like this. Nothing to do but refuse the connection.
            logger.LogWarning("A live session connection arrived without a usable device identity");
            Context.Abort();
            return;
        }

        registry.Register(
            identity.SessionId, identity.OrganizationId, Context.ConnectionId, identity.DeviceName);
        logger.LogInformation(
            "Device registered live session {SessionId} for organization {OrganizationId}",
            identity.SessionId, identity.OrganizationId);

        await base.OnConnectedAsync();
    }

    /// <summary>
    /// The owner's current state, sent on connect and after every change it makes. Absolute, so
    /// re-sending it after a reconnection is how the two ends resynchronise.
    /// </summary>
    public async Task ReportState(MirroredSessionState state)
    {
        var identity = ResolveIdentity();
        if (identity is null) return;

        await projector.ApplyAsync(identity.SessionId, identity.OrganizationId, state, identity.Caller);
    }

    /// <summary>The owner has stopped presenting. Distinct from losing the connection, which freezes.</summary>
    public Task EndSession()
    {
        var identity = ResolveIdentity();
        if (identity is null) return Task.CompletedTask;

        logger.LogInformation("Device ended live session {SessionId}", identity.SessionId);
        projector.End(identity.SessionId);
        return Task.CompletedTask;
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        var sessionId = registry.Disconnect(Context.ConnectionId);
        if (sessionId is not null)
        {
            // Deliberately not deactivated: what it was showing stays, so a public output freezes
            // on its slide rather than dropping to the waiting screen over a moment of bad wifi.
            logger.LogInformation(
                "Live session {SessionId} lost its owner; the last slide stays up", sessionId);
        }

        return base.OnDisconnectedAsync(exception);
    }

    private sealed record HubIdentity(
        string SessionId, string OrganizationId, string DeviceName, CallerContext Caller);

    private HubIdentity? ResolveIdentity()
    {
        var user = Context.User;
        var deviceId = user?.FindFirst("device_id")?.Value;
        var organizationId = user?.FindFirst("organization_id")?.Value;
        var userId = user?.FindFirst("user_id")?.Value;

        if (deviceId is null || organizationId is null || userId is null)
            return null;

        var role = Enum.TryParse<UserRole>(user!.FindFirst(ClaimTypes.Role)?.Value, out var parsed)
            ? parsed
            : UserRole.User;

        return new HubIdentity(
            DeviceSessionId.For(deviceId),
            organizationId,
            user.FindFirst("device_name")?.Value ?? "",
            new CallerContext(userId, role, organizationId));
    }
}
