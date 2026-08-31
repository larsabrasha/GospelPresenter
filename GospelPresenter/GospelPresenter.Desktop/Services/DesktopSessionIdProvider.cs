using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Gives the desktop app a session id that survives a restart, derived from the device token it
/// signed in with. Two things depend on it holding still: the live image URLs a projector and a
/// public output are already loading, and the mirrored session a mobile is pointed at to control
/// this machine.
///
/// Returns null — and so leaves the browser's per-tab id in place — for an installation that has
/// no device identity yet. That is a development build running without a server, or a machine
/// that has never signed in; neither has a server session to be consistent with.
/// </summary>
public class DesktopSessionIdProvider(DeviceAuthService auth) : ISessionIdProvider
{
    public string? GetSessionId() =>
        auth.CurrentIdentity?.DeviceId is { Length: > 0 } deviceId
            ? DeviceSessionId.For(deviceId)
            : null;
}
