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

        // NameIdentifier is not decoration. Antiforgery binds a token to the user who was shown the
        // form, and identifies them by their subject claim — falling back, when there is none, to
        // serializing every claim in the identity. This identity is rebuilt per request, so any
        // claim that is not a constant would make that fallback disagree with itself and reject
        // every form the app posts. There was such a claim: auth_time, stamped with the current
        // time on each pass. It is dropped rather than pinned, because it means the moment the user
        // signed in, and nothing here reads it — the session timeout it exists for belongs to the
        // web host's revalidating provider, which a device holding a long-lived token does not use.
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, identity.UserId),
            new(ClaimTypes.Name, identity.Name),
            new(ClaimTypes.Email, identity.Email),
            new(ClaimTypes.Role, identity.Role.ToString()),
            new("user_id", identity.UserId),
            new("organization_id", identity.OrganizationId),
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
