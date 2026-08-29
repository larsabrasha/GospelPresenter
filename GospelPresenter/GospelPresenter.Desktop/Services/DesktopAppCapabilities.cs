using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// What the desktop app cannot offer, matching the MAUI host's DeviceAppCapabilities: remote
/// displays pair with the web server's hub, calendar feeds are served by the web host, and
/// users/organisations/profiles live in tables outside the sync protocol — administer those on the
/// web. (PowerPoint import needs no flag: it disables itself when Gotenberg is unconfigured, which
/// it always is here.)
///
/// Worth revisiting now that the desktop runs a real HTTP server rather than a webview with a
/// custom scheme — remote displays on the local network are no longer impossible the way they were
/// on the device. Left as-is until someone asks for it, rather than turned on speculatively.
/// </summary>
public class DesktopAppCapabilities : IAppCapabilities
{
    public bool RemoteDisplays => false;
    public bool CalendarSubscriptions => false;
    public bool UserAdministration => false;
    public bool ProfileEditing => false;
}
