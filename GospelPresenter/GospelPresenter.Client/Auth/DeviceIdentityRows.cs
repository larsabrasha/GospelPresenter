using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Client.Auth;

/// <summary>
/// The device's own user and organisation, as rows in the local database.
///
/// Users and Organizations are outside the sync protocol, but nearly every synced row has a foreign
/// key into them, so these two are what the local library hangs from. They are built from the
/// cached <see cref="DeviceIdentity"/> rather than fetched, which means signing in can write them
/// before anything has been pulled — and has to. The avatar menu reads the signed-in user's name
/// and email out of this table, so a menu drawn before the first pull landed showed a blank name
/// over a silhouette and looked exactly like being signed out.
/// </summary>
public static class DeviceIdentityRows
{
    /// <summary>
    /// Upserts both rows on the caller's context, so a pull can do it inside its own transaction
    /// while a sign-in does it on a context of its own. True when something actually changed.
    /// </summary>
    public static async Task<bool> UpsertAsync(
        PresentationContext db, DeviceIdentity identity, CancellationToken ct = default)
    {
        var organization = await db.Organizations
            .FirstOrDefaultAsync(o => o.Id == identity.OrganizationId, ct);
        if (organization is null)
        {
            db.Organizations.Add(new Organization
            {
                Id = identity.OrganizationId,
                Name = identity.OrganizationName,
            });
        }
        else
        {
            organization.Name = identity.OrganizationName;
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == identity.UserId, ct);
        if (user is null)
        {
            db.Users.Add(new User
            {
                Id = identity.UserId,
                Name = identity.Name,
                Email = identity.Email,
                Role = identity.Role,
                OrganizationId = identity.OrganizationId,
            });
        }
        else
        {
            user.Name = identity.Name;
            user.Email = identity.Email;
            user.Role = identity.Role;
            user.OrganizationId = identity.OrganizationId;
        }

        // The profile image is deliberately absent: /api/me does not carry one, so there is nothing
        // to write and overwriting with null would blank whatever a pull might have left.
        return await db.SaveChangesAsync(ct) > 0;
    }
}
