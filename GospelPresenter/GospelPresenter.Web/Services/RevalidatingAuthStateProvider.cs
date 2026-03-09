using System.Security.Claims;
using GospelPresenter.Web.Configuration;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Server;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Web.Services;

/// <summary>
/// Periodically revalidates the authentication state within Blazor Server circuits.
/// Checks the auth_time claim against the configured session timeout to detect expired sessions,
/// since the persistent WebSocket connection would otherwise keep the user "logged in" in the UI
/// even after the cookie expires.
/// </summary>
public class RevalidatingAuthStateProvider(
    ILoggerFactory loggerFactory,
    IOptions<Settings> settings)
    : RevalidatingServerAuthenticationStateProvider(loggerFactory)
{
    protected override TimeSpan RevalidationInterval => TimeSpan.FromMinutes(1);

    protected override Task<bool> ValidateAuthenticationStateAsync(
        AuthenticationState authenticationState, CancellationToken cancellationToken)
    {
        var user = authenticationState.User;
        if (user.Identity?.IsAuthenticated != true)
            return Task.FromResult(false);

        var authTimeClaim = user.FindFirstValue("auth_time");
        if (authTimeClaim == null || !long.TryParse(authTimeClaim, out var unixSeconds))
            return Task.FromResult(true);

        var authTime = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
        var elapsed = DateTimeOffset.UtcNow - authTime;
        var timeout = TimeSpan.FromMinutes(settings.Value.SessionTimeoutMinutes);

        return Task.FromResult(elapsed < timeout);
    }
}
