using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;

namespace GospelPresenter.Shared;

public static class SharedServicesSetup
{
    public static void AddSharedGospelPresenterServices(this IServiceCollection services)
    {
        services.AddSingleton<AppState>();
    }
}
