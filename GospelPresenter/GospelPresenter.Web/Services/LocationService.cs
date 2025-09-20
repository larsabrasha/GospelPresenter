using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web.Services;

public class LocationService : ILocationService
{
    public Task RequestLocationPermissionAsync()
    {
        return Task.CompletedTask;
    }
}
