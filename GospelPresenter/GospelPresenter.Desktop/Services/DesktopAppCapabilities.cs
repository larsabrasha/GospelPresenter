using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// What the desktop app offers.
///
/// Remote control and the public QR output work here because the app mirrors its live session up to
/// the server — see adr/0004-mirrored-desktop-live-sessions.md. Paired screens still do not: the
/// pairing is held by the server, and a browser on the local network has no way to reach a session
/// that only exists on this machine.
///
/// The rest stays as it was: calendar feeds are served by the web host, and users, organisations
/// and profiles live in tables outside the sync protocol — administer those on the web.
/// (PowerPoint import needs no flag: it disables itself when Gotenberg is unconfigured, which it
/// always is here.)
/// </summary>
public class DesktopAppCapabilities : IAppCapabilities
{
    public bool RemoteControl => true;
    public bool PublicOutput => true;
    public bool PairedDisplays => false;
    public bool CalendarSubscriptions => false;
    public bool UserAdministration => false;
    public bool ProfileEditing => false;
}
