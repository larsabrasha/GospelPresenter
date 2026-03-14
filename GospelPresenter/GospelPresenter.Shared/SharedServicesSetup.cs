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
        services.AddScoped<ActiveOrganizationState>();
        services.AddSingleton(new SharedAppState(TimeSpan.FromMinutes(timeoutMinutes)));
        services.AddSingleton<IImageService, ImageService>();
        services.AddScoped<IOrganizationImageService, OrganizationImageService>();
        services.AddSingleton<IProfileImageService, ProfileImageService>();
        services.AddSingleton<IBibleService, BibleService>();
        services.AddSingleton<IBibleTextService, BibleTextService>();
    }
}
