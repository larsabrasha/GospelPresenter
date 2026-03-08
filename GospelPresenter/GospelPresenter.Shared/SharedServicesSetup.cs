using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GospelPresenter.Shared;

public static class SharedServicesSetup
{
    public static void AddSharedGospelPresenterServices(this IServiceCollection services, IConfiguration? configuration = null)
    {
        var timeoutMinutes = configuration?.GetValue("Settings:SessionTimeoutMinutes", 240) ?? 240;

        services.AddScoped<AppState>();
        services.AddSingleton(new SharedAppState(TimeSpan.FromMinutes(timeoutMinutes)));
        services.AddSingleton<ISongService, SongService>();
        services.AddSingleton<IImageService, ImageService>();
        services.AddSingleton<IBibleService, BibleService>();
        services.AddSingleton<IBibleTextService, BibleTextService>();
    }
}
