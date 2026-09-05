using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// What the desktop app offers.
///
/// Remote control and the public QR output both work here because the app mirrors its live session
/// up to the server — see adr/0004-mirrored-desktop-live-sessions.md.
///
/// The output took a second pass. Mirroring carried the slide but not the output that shows it, and
/// a QR code created here resolved to a 404 on the first real service: outputs now sync like every
/// other row, and the owner's report says which of them it has switched on.
///
/// Paired screens do not work, and for a reason that will not go away: the pairing is held by
/// the server, and a browser on the local network has no way to reach a session that only exists on
/// this machine.
///
/// The rest stays as it was: calendar feeds are served by the web host, and users, organisations
/// and profiles live in tables outside the sync protocol — administer those on the web.
///
/// This host serves no /api/upload endpoints, so imports that need one are told to. Images, audio,
/// songs and Bibles do not need one: they run through the domain services and work offline. Slides
/// do — a PowerPoint has to reach the converter the web host talks to — so that tab says where to
/// go instead of offering a button that fails.
/// </summary>
public class DesktopAppCapabilities : IAppCapabilities
{
    public bool RemoteControl => true;
    public bool PublicOutput => true;
    public bool PairedDisplays => false;
    public bool CalendarSubscriptions => false;
    public bool UserAdministration => false;
    public bool ProfileEditing => false;
    public bool UploadEndpoints => false;
}
