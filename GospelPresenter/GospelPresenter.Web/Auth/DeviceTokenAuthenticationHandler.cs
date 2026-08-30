using System.Security.Claims;
using System.Text.Encodings.Web;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Sync;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Web.Auth;

/// <summary>
/// Authenticates requests carrying <c>Authorization: Bearer gpdt_…</c> — the long-lived tokens the
/// MAUI app receives at first login. The handler emits the same claims the cookie sign-in does
/// (<c>user_id</c>, <c>organization_id</c>, role), so every claims-reading endpoint — media,
/// upload, sync — serves device clients unchanged.
///
/// The user is loaded on every request rather than baked into the token: the role stays current,
/// and a deleted user or revoked token stops working immediately, mirroring the cookie pipeline's
/// RejectDeletedUser. The lookup is cached briefly for the same reason the cookie check is.
/// </summary>
public class DeviceTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IDbContextFactory<PresentationContext> dbContextFactory,
    IMemoryCache cache) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "DeviceToken";

    private static readonly TimeSpan PrincipalCacheDuration = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan LastUsedWriteInterval = TimeSpan.FromMinutes(5);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.FirstOrDefault();
        if (header is null || !header.StartsWith($"Bearer {DeviceToken.Prefix}", StringComparison.Ordinal))
            return AuthenticateResult.NoResult();

        var plaintext = header["Bearer ".Length..];
        var tokenHash = DeviceToken.HashKey(plaintext);

        var cacheKey = $"device-token:{tokenHash}";
        if (cache.TryGetValue(cacheKey, out ClaimsPrincipal? cachedPrincipal) && cachedPrincipal is not null)
            return AuthenticateResult.Success(new AuthenticationTicket(cachedPrincipal, SchemeName));

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var match = await context.DeviceTokens
            .Where(t => t.TokenHash == tokenHash && t.RevokedAt == null)
            .Select(t => new
            {
                Token = t,
                t.User.Role,
                UserOrganizationId = t.User.OrganizationId,
            })
            .FirstOrDefaultAsync();

        if (match is null)
            return AuthenticateResult.Fail("Unknown or revoked device token.");

        // A user who moved to another organization keeps their device, not their old data scope.
        if (match.UserOrganizationId != match.Token.OrganizationId)
            return AuthenticateResult.Fail("Device token no longer matches the user's organization.");

        // The version rides along on the throttled LastUsedAt write rather than costing its own:
        // it feeds /admin/devices, which exists so the protocol floor is raised against a measured
        // distribution. Sampled every few minutes is more than enough for that, and a version that
        // changed is caught the first time the write interval elapses after the restart.
        var reportedVersion = Request.Headers[SyncProtocol.VersionHeader].FirstOrDefault() is { Length: > 0 } v
            ? v[..Math.Min(v.Length, DeviceToken.MaxVersionLength)]
            : null;
        var reportedProtocol = Request.Headers.TryGetValue(SyncProtocol.ProtocolHeader, out var raw)
            ? SyncProtocol.Parse(raw.FirstOrDefault())
            : (int?)null;

        var stale = match.Token.LastUsedAt is null
                    || DateTimeOffset.UtcNow - match.Token.LastUsedAt > LastUsedWriteInterval;
        var versionChanged = reportedVersion is not null && reportedVersion != match.Token.LastSeenVersion;

        if (stale || versionChanged)
        {
            // DeviceToken is server-only and not ISyncTracked, so this ExecuteUpdateAsync needs no
            // ModifiedAt and produces no tombstone.
            await context.DeviceTokens
                .Where(t => t.Id == match.Token.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.LastUsedAt, DateTimeOffset.UtcNow)
                    .SetProperty(t => t.LastSeenVersion, reportedVersion ?? match.Token.LastSeenVersion)
                    .SetProperty(t => t.LastSeenProtocol, reportedProtocol ?? match.Token.LastSeenProtocol));
        }

        var identity = new ClaimsIdentity(SchemeName);
        // The token's own id, so a caller can be tied to the one device it presented rather than
        // only to the user behind it. It is what the mirrored live session is keyed on.
        identity.AddClaim(new Claim("device_id", match.Token.Id));
        // The name the user gave this device when they registered it, so a controller can say which
        // machine it is about to drive rather than numbering them. Carried as a claim because the
        // token row is already loaded here; a renamed device keeps its old label until this
        // principal falls out of the cache, which is the right trade for a display string.
        identity.AddClaim(new Claim("device_name", match.Token.Name));
        identity.AddClaim(new Claim("user_id", match.Token.UserId));
        identity.AddClaim(new Claim("organization_id", match.Token.OrganizationId));
        identity.AddClaim(new Claim(ClaimTypes.Role, match.Role.ToString()));
        var principal = new ClaimsPrincipal(identity);

        cache.Set(cacheKey, principal, PrincipalCacheDuration);

        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }
}
