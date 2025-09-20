using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

public class LocationService : ILocationService
{
    public async Task RequestLocationPermissionAsync()
    {
        var status = await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();
        if (status is not PermissionStatus.Granted)
        {
            await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
        }
    }
}
