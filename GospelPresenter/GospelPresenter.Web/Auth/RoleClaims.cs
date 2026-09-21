using System.Security.Claims;
using GospelPresenter.Shared.Models;

namespace GospelPresenter.Web.Auth;

/// <summary>
/// The role on a signed-in principal comes from the database and from nowhere else. An OpenID
/// Connect provider may put a <c>role</c> claim of its own in the token, and the default inbound
/// mapping lands it on <see cref="ClaimTypes.Role"/> ahead of anything added later; every reader in
/// the app takes the first role claim it finds. So the provider's are removed before ours is added.
/// </summary>
public static class RoleClaims
{
    private static readonly string[] RoleClaimTypes = [ClaimTypes.Role, "role", "roles"];

    public static void SetRole(ClaimsIdentity identity, UserRole role)
    {
        foreach (var stale in identity.Claims.Where(c => RoleClaimTypes.Contains(c.Type)).ToList())
            identity.RemoveClaim(stale);

        identity.AddClaim(new Claim(ClaimTypes.Role, role.ToString()));
    }
}
