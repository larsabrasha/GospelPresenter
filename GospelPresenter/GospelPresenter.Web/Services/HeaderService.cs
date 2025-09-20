using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Utils;

namespace GospelPresenter.Web.Services;

public class HeaderService : IHeaderService
{
    public IDictionary<string, string> AppHeaders { get; } = new Dictionary<string, string>
    {
        { GospelPresenterHeaders.System, "GospelPresenter.Web" },
        { GospelPresenterHeaders.AppId, "com.gospelpresenter.web.test" },
        { GospelPresenterHeaders.AppVersion, "1.0" },
        { GospelPresenterHeaders.DeviceManufacturer, "" },
        { GospelPresenterHeaders.DeviceModel, "" },
        { GospelPresenterHeaders.DevicePlatform, "" },
        { GospelPresenterHeaders.DeviceOsVersion, "" }
    };
}
