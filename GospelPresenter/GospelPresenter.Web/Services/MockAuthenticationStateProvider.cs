using System.Security.Claims;
using GospelPresenter.Shared.Models;
using Microsoft.AspNetCore.Components.Authorization;

namespace GospelPresenter.Web.Services;

/// <summary>
/// Authentication state provider for mock mode. Reads the authenticated user from
/// the HTTP context (set by the mock auto-sign-in middleware in Program.cs).
/// </summary>
public class MockAuthenticationStateProvider(IHttpContextAccessor httpContextAccessor) : AuthenticationStateProvider
{
    private readonly AuthenticationState state = new(
        httpContextAccessor.HttpContext?.User ?? new ClaimsPrincipal(new ClaimsIdentity()));

    public override Task<AuthenticationState> GetAuthenticationStateAsync()
        => Task.FromResult(state);

    public static ClaimsPrincipal CreatePrincipal(User user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, user.Name),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role.ToString()),
            new("user_id", user.Id),
            new("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
        };

        if (user.OrganizationId is not null)
            claims.Add(new Claim("organization_id", user.OrganizationId));

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Mock"));
    }
}
