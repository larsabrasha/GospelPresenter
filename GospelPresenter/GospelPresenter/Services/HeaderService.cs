using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Utils;

namespace GospelPresenter.Services;

public class HeaderService : IHeaderService
{
    public IDictionary<string, string> AppHeaders { get; } = new Dictionary<string, string>
    {
        { GospelPresenterHeaders.System, "GospelPresenter" },
        { GospelPresenterHeaders.AppId, AppInfo.PackageName },
        { GospelPresenterHeaders.AppVersion, AppInfo.VersionString },
        { GospelPresenterHeaders.DeviceManufacturer, DeviceInfo.Manufacturer },
        { GospelPresenterHeaders.DeviceModel, DeviceInfo.Model },
        { GospelPresenterHeaders.DevicePlatform, DeviceInfo.Platform.ToString() },
        { GospelPresenterHeaders.DeviceOsVersion, DeviceInfo.VersionString }
    };
}
