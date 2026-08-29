using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// TEMPORARY, until the device-token sign-in is wired into this host: a fixed developer identity so
/// the app boots straight to the dashboard against the local database. Mirrors the claims the
/// server's sign-in issues, and the same shape the MAUI host used.
/// </summary>
public class DevAuthenticationStateProvider : AuthenticationStateProvider
{
    public const string UserId = "dev-user";
    public const string OrganizationId = "dev-org";
    public const string SchemeName = "DeviceIdentity";

    /// <summary>
    /// The one definition of who is signed in. Both the Blazor auth state and the HTTP
    /// authentication scheme below are built from it, so they can never disagree — and when real
    /// sign-in lands, both are replaced together.
    /// </summary>
    public static ClaimsPrincipal Principal { get; } = new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.Name, "Utvecklare"),
        new Claim(ClaimTypes.Email, "dev@example.com"),
        new Claim(ClaimTypes.Role, nameof(Shared.Models.UserRole.Admin)),
        new Claim("user_id", UserId),
        new Claim("organization_id", OrganizationId),
        new Claim("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
    ], SchemeName));

    private static readonly AuthenticationState State = new(Principal);

    public override Task<AuthenticationState> GetAuthenticationStateAsync() => Task.FromResult(State);
}

/// <summary>
/// TEMPORARY, and the HTTP half of the identity above.
///
/// Unlike the MAUI host, this one is a real web server, so a page component marked [Authorize] is
/// also an endpoint marked [Authorize]: the authorization middleware runs before the component ever
/// renders, and without a scheme to challenge it fails the request outright rather than showing the
/// login page. The device token becomes this scheme's credential once sign-in exists.
/// </summary>
public class DevAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory loggerFactory,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, loggerFactory, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
        Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(
            DevAuthenticationStateProvider.Principal, DevAuthenticationStateProvider.SchemeName)));
}
