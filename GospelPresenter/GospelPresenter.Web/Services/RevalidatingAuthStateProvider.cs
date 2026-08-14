using System.Security.Claims;
using GospelPresenter.Shared.Services;
using GospelPresenter.Web.Configuration;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Server;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Web.Services;

/// <summary>
/// Periodically revalidates the authentication state within Blazor Server circuits.
/// The persistent WebSocket connection would otherwise keep the user "logged in" in the UI
/// even after their access should have ended, so two things are checked:
/// the auth_time claim against the configured session timeout (an expired cookie), and whether
/// the user account still exists (a deleted user must lose access without waiting for the timeout).
/// </summary>
public class RevalidatingAuthStateProvider(
    ILoggerFactory loggerFactory,
    IOptions<Settings> settings,
    IUserService userService)
    : RevalidatingServerAuthenticationStateProvider(loggerFactory)
{
    private readonly ILogger<RevalidatingAuthStateProvider> logger =
        loggerFactory.CreateLogger<RevalidatingAuthStateProvider>();

    protected override TimeSpan RevalidationInterval => TimeSpan.FromMinutes(1);

    protected override async Task<bool> ValidateAuthenticationStateAsync(
        AuthenticationState authenticationState, CancellationToken cancellationToken)
    {
        var user = authenticationState.User;
        if (user.Identity?.IsAuthenticated != true)
            return false;

        if (IsSessionExpired(user))
            return false;

        return await UserStillExistsAsync(user, cancellationToken);
    }

    private bool IsSessionExpired(ClaimsPrincipal user)
    {
        var authTimeClaim = user.FindFirstValue("auth_time");
        if (authTimeClaim == null || !long.TryParse(authTimeClaim, out var unixSeconds))
            return false;

        var authTime = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
        var elapsed = DateTimeOffset.UtcNow - authTime;
        var timeout = TimeSpan.FromMinutes(settings.Value.SessionTimeoutMinutes);

        return elapsed >= timeout;
    }

    private async Task<bool> UserStillExistsAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var userId = user.FindFirstValue("user_id");
        if (string.IsNullOrEmpty(userId))
            return true;

        try
        {
            var exists = await userService.UserExistsAsync(userId, cancellationToken);
            if (!exists)
                logger.LogInformation("Ending session for user {UserId}: the account no longer exists.", userId);

            return exists;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Keep the session alive if the database is unreachable. Signing everyone out during a
            // database blip would interrupt a service in progress, and without the database the app
            // cannot show any content anyway — so an unverified session gains nothing meanwhile.
            logger.LogWarning(ex, "Could not verify that user {UserId} still exists; keeping the session.", userId);
            return true;
        }
    }
}
