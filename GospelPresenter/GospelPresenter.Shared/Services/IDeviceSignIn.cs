namespace GospelPresenter.Shared.Services;

/// <summary>
/// The interactive sign-in a device app performs: open the server's /app-login in the system
/// browser, receive the device token on the callback URL, and cache the identity locally.
/// Registered only by the MAUI host — the sign-in UI resolves it optionally, so the web app
/// (whose sign-in is the cookie flow) is untouched by its absence.
/// </summary>
public interface IDeviceSignIn
{
    /// <summary>True when signed in; false when the user cancelled or the flow failed.</summary>
    Task<bool> SignInAsync(CancellationToken cancellationToken = default);
}
