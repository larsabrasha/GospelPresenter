using GospelPresenter.Shared.Configuration;
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

        services.AddLocalization(options => options.ResourcesPath = "Resources");
        services.AddScoped<ToastService>();
        services.AddScoped<AppState>();
        services.AddScoped<ActiveOrganizationState>();
        services.AddSingleton(new SharedAppState(TimeSpan.FromMinutes(timeoutMinutes)));
        services.AddSingleton<IImageService, ImageService>();
        services.AddSingleton<IProfileImageService, ProfileImageService>();
        services.AddSingleton<IImageResizeService, ImageResizeService>();
        services.AddSingleton<IBibleService, BibleService>();
        services.AddSingleton<IBibleTextService, BibleTextService>();

        var s3Endpoint = configuration?.GetSection("S3")["Endpoint"];
        if (configuration is not null && !string.IsNullOrEmpty(s3Endpoint))
        {
            services.Configure<S3Options>(configuration.GetSection("S3"));
            services.AddSingleton<IObjectStorageService, ObjectStorageService>();
        }
        else
        {
            services.AddSingleton<IObjectStorageService, NullObjectStorageService>();
        }
    }
}
