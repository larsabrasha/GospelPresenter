using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;

namespace GospelPresenter.Shared;

public static class SharedServicesSetup
{
    public static void AddSharedGospelPresenterServices(this IServiceCollection services)
    {
        services.AddScoped<AppState>();
        services.AddSingleton<SharedAppState>();
        services.AddSingleton<ISongService, SongService>();
        services.AddSingleton<IImageService, ImageService>();
        services.AddSingleton<IBibleService, BibleService>();
        services.AddSingleton<IBibleTextService, BibleTextService>();
    }
}
