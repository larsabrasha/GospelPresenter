using System.Security.Claims;
using GospelPresenter.Shared.Models;
using GospelPresenter.Web.Auth;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The role comes from the database. An identity provider that puts a role claim in its token must
/// not be able to outrank it — every reader in the app takes the first role claim it finds.
/// </summary>
public class RoleClaimsTests
{
    [Fact]
    public void SetRole_WhenTheProviderAlreadySentARole_TheDatabaseRoleIsTheOnlyOneLeft()
    {
        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, "subject"),
            new Claim(ClaimTypes.Role, "SuperAdmin"),
            new Claim("role", "SuperAdmin"),
            new Claim("roles", "SuperAdmin"),
        ], "oidc");

        RoleClaims.SetRole(identity, UserRole.User);

        identity.FindAll(c => c.Type is ClaimTypes.Role or "role" or "roles")
            .Select(c => (c.Type, c.Value))
            .ShouldBe([(ClaimTypes.Role, "User")]);
        identity.FindFirst(ClaimTypes.Role)!.Value.ShouldBe("User");
        identity.FindFirst(ClaimTypes.NameIdentifier)!.Value.ShouldBe("subject");
    }

    [Fact]
    public void SetRole_OnAnIdentityWithoutARole_AddsIt()
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "subject")], "google");

        RoleClaims.SetRole(identity, UserRole.Admin);

        identity.FindFirst(ClaimTypes.Role)!.Value.ShouldBe("Admin");
    }
}
