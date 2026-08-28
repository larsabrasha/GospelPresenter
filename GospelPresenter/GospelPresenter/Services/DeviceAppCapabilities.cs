using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

/// <summary>
/// What the device app cannot offer: remote displays pair with the web server's hub, calendar
/// feeds are served by the web host, and users/organisations/profiles live in tables outside the
/// sync protocol — administer those on the web. (PowerPoint import needs no flag: it disables
/// itself when Gotenberg is unconfigured, which it always is on the device.)
/// </summary>
public class DeviceAppCapabilities : IAppCapabilities
{
    public bool RemoteDisplays => false;
    public bool CalendarSubscriptions => false;
    public bool UserAdministration => false;
    public bool ProfileEditing => false;
}
