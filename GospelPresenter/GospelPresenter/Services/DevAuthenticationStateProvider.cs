using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;

namespace GospelPresenter.Services;

/// <summary>
/// TEMPORARY (until the device-token login lands): a fixed developer identity so the app boots
/// straight to the dashboard against the local database. The matching user and organisation rows
/// are seeded by MauiProgram in DEBUG builds. Mirrors the claims the server's sign-in issues.
/// </summary>
public class DevAuthenticationStateProvider : AuthenticationStateProvider
{
    public const string UserId = "dev-user";
    public const string OrganizationId = "dev-org";

    private static readonly AuthenticationState State = new(new ClaimsPrincipal(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.Name, "Utvecklare"),
        new Claim(ClaimTypes.Email, "dev@example.com"),
        new Claim(ClaimTypes.Role, nameof(Shared.Models.UserRole.Admin)),
        new Claim("user_id", UserId),
        new Claim("organization_id", OrganizationId),
        new Claim("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
    ], "Dev")));

    public override Task<AuthenticationState> GetAuthenticationStateAsync() => Task.FromResult(State);
}
