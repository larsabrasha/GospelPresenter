using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// What the desktop app offers.
///
/// Remote control works here because the app mirrors its live session up to the server — see
/// adr/0004-mirrored-desktop-live-sessions.md.
///
/// The public QR output does not, yet. Mirroring carries the slide but not the output: RemoteDisplay
/// is not ISyncTracked, so an output created here has no row on the server for /watch/{code} to find,
/// and the binding from an output to a session lives in each host's own RemoteDisplayState with no
/// field in MirroredSessionState to carry it. The flag was switched on with the mirroring and the
/// gap only showed up against real hardware: the QR code resolved to a 404. Off until the three
/// pieces named in that ADR's consequences are built.
///
/// Paired screens do not work either, and for a reason that will not go away: the pairing is held by
/// the server, and a browser on the local network has no way to reach a session that only exists on
/// this machine.
///
/// The rest stays as it was: calendar feeds are served by the web host, and users, organisations
/// and profiles live in tables outside the sync protocol — administer those on the web.
/// (PowerPoint import needs no flag: it disables itself when Gotenberg is unconfigured, which it
/// always is here.)
/// </summary>
public class DesktopAppCapabilities : IAppCapabilities
{
    public bool RemoteControl => true;
    public bool PublicOutput => false;
    public bool PairedDisplays => false;
    public bool CalendarSubscriptions => false;
    public bool UserAdministration => false;
    public bool ProfileEditing => false;
}
