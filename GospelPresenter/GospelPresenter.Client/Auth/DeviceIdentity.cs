using GospelPresenter.Shared.Models;

namespace GospelPresenter.Client.Auth;

/// <summary>
/// The signed-in user as the device knows them, cached at login so the app is fully usable
/// offline. The role is refreshed whenever the identity is re-fetched (login, and later on
/// successful syncs); between refreshes the cached role stands — by design, since the device may
/// be offline indefinitely.
/// </summary>
public record DeviceIdentity(
    string UserId,
    string Name,
    string Email,
    UserRole Role,
    string OrganizationId,
    string OrganizationName);
