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
        // The MAUI host overrides this with its own reduced capability set after calling this.
        services.AddSingleton<IAppCapabilities, FullAppCapabilities>();
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
        // Registered here rather than per host because the slide builder below depends on it: a
        // host that got the builder without the song service built a container that could not be
        // validated, which is how the migration tool — which wants neither, but takes this whole
        // set — stopped starting.
        services.AddSingleton<ISongService, SongService>();
        // Stateless, and ISongService is a singleton too: one instance serves every circuit.
        services.AddSingleton<ILiveSlideBuilder, LiveSlideBuilder>();
        // Singleton so the built-in theme definitions are cached once for the whole process.
        services.AddSingleton<IThemeService, ThemeService>();
        services.AddSingleton<IThemeAssetService, ThemeAssetService>();

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
