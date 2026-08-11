using GospelPresenter.Shared.Configuration;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared;

public static class SharedServicesSetup
{
    public static void AddSharedGospelPresenterServices(this IServiceCollection services, IConfiguration? configuration = null)
    {
        var timeoutMinutes = configuration?.GetValue("Settings:SessionTimeoutMinutes", 240) ?? 240;
        var maxPublicViewers = configuration?.GetValue("Settings:PublicOutputMaxViewers", 500) ?? 500;

        services.AddLocalization(options => options.ResourcesPath = "Resources");
        services.AddScoped<ToastService>();
        services.AddScoped<AppState>();
        services.AddScoped<ActiveOrganizationState>();
        services.AddSingleton<SharedAppState>(sp => new SharedAppState(
            TimeSpan.FromMinutes(timeoutMinutes),
            sp.GetRequiredService<ILogger<SharedAppState>>()));
        services.AddSingleton<RemoteDisplayState>();
        services.AddSingleton<PublicOutputState>(_ => new PublicOutputState(maxPublicViewers));
        services.AddSingleton<PublicOutputBroadcaster>();
        services.AddScoped<IRemoteDisplayService, RemoteDisplayService>();
        services.AddScoped<ISongPartLabelService, SongPartLabelService>();
        services.AddSingleton<IImageService, ImageService>();
        services.AddSingleton<IProfileImageService, ProfileImageService>();
        services.AddSingleton<IImageResizeService, ImageResizeService>();
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
