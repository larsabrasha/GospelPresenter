using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;

namespace GospelPresenter.Client.Auth;

/// <summary>
/// Serves the cached device identity as the app's authentication state — the same claims the
/// server's sign-in issues, so every shared component and permission policy works unchanged.
/// No revalidation and no expiry: the device is signed in until the user signs out or the server
/// revokes the token (which the sync engine surfaces separately, without locking the UI).
/// </summary>
public class DeviceAuthStateProvider : AuthenticationStateProvider, IDisposable
{
    private static readonly AuthenticationState Anonymous = new(new ClaimsPrincipal(new ClaimsIdentity()));

    private readonly DeviceAuthService auth;

    public DeviceAuthStateProvider(DeviceAuthService auth)
    {
        this.auth = auth;
        auth.Changed += OnChanged;
    }

    public override Task<AuthenticationState> GetAuthenticationStateAsync()
    {
        if (auth.CurrentIdentity is not { } identity)
            return Task.FromResult(Anonymous);

        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, identity.Name),
            new(ClaimTypes.Email, identity.Email),
            new(ClaimTypes.Role, identity.Role.ToString()),
            new("user_id", identity.UserId),
            new("organization_id", identity.OrganizationId),
            new("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
        };
        return Task.FromResult(new AuthenticationState(
            new ClaimsPrincipal(new ClaimsIdentity(claims, "Device"))));
    }

    private void OnChanged() => NotifyAuthenticationStateChanged(GetAuthenticationStateAsync());

    public void Dispose() => auth.Changed -= OnChanged;
}
