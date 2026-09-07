using System.Security.Claims;
using GospelPresenter.Shared.Models;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace GospelPresenter.Web.Auth;

/// <summary>
/// Brings a cookie session's role and organisation claims up to date with the database. Called from
/// cookie validation; when nothing changed it does nothing, and when something did it swaps in a
/// principal carrying the current values and asks for the cookie to be reissued, so the change
/// sticks for the requests that follow.
/// </summary>
public static class SessionClaims
{
    public const string OrganizationClaim = "organization_id";

    public static void Refresh(CookieValidatePrincipalContext context, UserRole role, string? organizationId)
    {
        if (context.Principal?.Identity is not ClaimsIdentity identity) return;

        var roleIsCurrent = identity.FindFirst(ClaimTypes.Role)?.Value == role.ToString();
        var organizationIsCurrent = identity.FindFirst(OrganizationClaim)?.Value == organizationId;
        if (roleIsCurrent && organizationIsCurrent) return;

        var refreshed = new ClaimsIdentity(identity.Claims, identity.AuthenticationType, identity.NameClaimType, identity.RoleClaimType);
        RoleClaims.SetRole(refreshed, role);
        foreach (var stale in refreshed.FindAll(OrganizationClaim).ToList())
            refreshed.RemoveClaim(stale);
        if (organizationId is not null)
            refreshed.AddClaim(new Claim(OrganizationClaim, organizationId));

        context.ReplacePrincipal(new ClaimsPrincipal(refreshed));
        context.ShouldRenew = true;
    }
}
