using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

public class DeviceCapabilities : IDeviceCapabilities
{
    public bool HasOfflineStorage => true;
}
