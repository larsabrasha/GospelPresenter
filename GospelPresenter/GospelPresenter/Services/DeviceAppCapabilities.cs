using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

/// <summary>
/// What the device app cannot offer: remote displays pair with the web server's hub, calendar
/// feeds are served by the web host, and users/organisations/profiles live in tables outside the
/// sync protocol — administer those on the web. There are no /api/upload endpoints here either:
/// images, audio, songs and Bibles import through the domain services and work offline, while the
/// slides tab says where PowerPoint import has to be done.
/// </summary>
public class DeviceAppCapabilities : IAppCapabilities
{
    public bool RemoteControl => false;
    public bool PublicOutput => false;
    public bool PairedDisplays => false;
    public bool CalendarSubscriptions => false;
    public bool UserAdministration => false;
    public bool ProfileEditing => false;
    public bool UploadEndpoints => false;
}
