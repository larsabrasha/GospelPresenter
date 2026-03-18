using System.Security.Claims;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Components.Authorization;

namespace GospelPresenter.Web.Services;

/// <summary>
/// Authentication state provider for mock mode that auto-authenticates with the mock user.
/// Used when no database connection string is configured.
/// </summary>
public class MockAuthenticationStateProvider : AuthenticationStateProvider
{
    private readonly AuthenticationState state;

    public MockAuthenticationStateProvider(IUserService userService)
    {
        var user = userService.GetByLoginAsync("mock", "mock").GetAwaiter().GetResult();
        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, user!.Name),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role.ToString()),
            new("user_id", user.Id),
            new("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
        };

        if (user.OrganizationId is not null)
            claims.Add(new Claim("organization_id", user.OrganizationId));

        var identity = new ClaimsIdentity(claims, "Mock");
        state = new AuthenticationState(new ClaimsPrincipal(identity));
    }

    public override Task<AuthenticationState> GetAuthenticationStateAsync()
        => Task.FromResult(state);
}
