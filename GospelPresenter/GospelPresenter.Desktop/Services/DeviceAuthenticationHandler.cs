using System.Security.Claims;
using System.Text.Encodings.Web;
using GospelPresenter.Client.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// The HTTP half of the device's identity, reading the same <see cref="DeviceAuthService"/> that
/// DeviceAuthStateProvider serves to Blazor, so the two cannot drift apart.
///
/// The MAUI host needed nothing like this: with no HTTP pipeline, [Authorize] on a page component
/// was only ever a component-level check that AuthorizeRouteView answered by rendering the login
/// page. Here a routable component is also an endpoint, so the authorization middleware runs first
/// and has to be given the same answer — including the redirect, or an unauthenticated visit to an
/// admin page would be a bare 401 where the app means "sign in".
/// </summary>
public class DeviceAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory loggerFactory,
    UrlEncoder encoder,
    DeviceAuthService auth)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, loggerFactory, encoder)
{
    public const string SchemeName = "DeviceIdentity";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (auth.CurrentIdentity is not { } identity)
            return Task.FromResult(AuthenticateResult.NoResult());

        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, identity.Name),
            new(ClaimTypes.Email, identity.Email),
            new(ClaimTypes.Role, identity.Role.ToString()),
            new("user_id", identity.UserId),
            new("organization_id", identity.OrganizationId),
            new("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
        };

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.Redirect($"/login?returnUrl={Uri.EscapeDataString(Request.Path + Request.QueryString)}");
        return Task.CompletedTask;
    }
}
