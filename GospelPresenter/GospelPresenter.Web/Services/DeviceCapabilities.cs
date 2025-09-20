using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web.Services;

public class DeviceCapabilities : IDeviceCapabilities
{
    public bool HasOfflineStorage => false;
}
