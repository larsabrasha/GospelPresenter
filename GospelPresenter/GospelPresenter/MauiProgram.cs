using GospelPresenter.Configuration;
using GospelPresenter.Services;
using GospelPresenter.Shared;
using GospelPresenter.Shared.HttpClients;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Services.Auth;
using GospelPresenter.Shared.Services.InitialData;
using Microsoft.AspNetCore.Components.WebView.Maui;
using Microsoft.Extensions.Logging;
using Serilog;
using Serilog.Events;
using System.Globalization;
using AuthService = GospelPresenter.Services.Auth.AuthService;

#if IOS || MACCATALYST
using GospelPresenter.AppleWebInterceptor;
#endif

#if ANDROID
using GospelPresenter.WebInterceptor;
#endif

#if WINDOWS
using GospelPresenter.WebInterceptor;
using Microsoft.Web.WebView2.Core;
#endif

namespace GospelPresenter;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
            .MinimumLevel.Override("ZiggyCreatures.Caching.Fusion", LogEventLevel.Warning)
            .MinimumLevel.Override("GospelPresenter", LogEventLevel.Debug)
#if DEBUG
            .WriteTo.Debug()
#endif
#if IOS || MACCATALYST
            .WriteTo.NSLog()
#elif ANDROID
            .WriteTo.AndroidLog()
#endif
            .WriteTo.File(Path.Combine(FileSystem.Current.AppDataDirectory, "log.txt"),
                rollingInterval: RollingInterval.Day,
                fileSizeLimitBytes: 10_000_000,
                retainedFileCountLimit: 7)
            .CreateLogger();

        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts => { fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular"); })
            .ConfigureMauiHandlers(handlers =>
            {
#if IOS || MACCATALYST
                handlers.AddHandler<BlazorWebView, AppleBlazorWebViewHandler>();
#elif ANDROID
                handlers.AddHandler<BlazorWebView, AndroidBlazorWebViewHandler>();
#elif WINDOWS
                handlers.AddHandler<BlazorWebView, WindowsBlazorWebViewHandler>();
#endif
            });

        builder.Services.AddSerilog();

        builder.Services.AddMauiBlazorWebView();

// #if DEBUG
        builder.Services.AddBlazorWebViewDeveloperTools();
        builder.Logging.AddDebug();
// #endif

        builder.Services.AddSharedGospelPresenterServices();
        builder.Services.AddSingleton<IFormFactor, FormFactor>();
        builder.Services.AddSingleton<IDeviceCapabilities, DeviceCapabilities>();
        builder.Services.AddSingleton<IStatusBarService, StatusBarService>();
        builder.Services.AddSingleton<IBuildInfoService, BuildInfoService>();
        builder.Services.AddSingleton<ILocationService, LocationService>();
        builder.Services.AddSingleton<IAuthService, AuthService>();
        builder.Services.AddSingleton<IInitialDataService, InitialDataService>();
        builder.Services.AddSingleton<IHeaderService, HeaderService>();
        
        builder.Services.AddTransient<AuthTokenHandler>();
        builder.Services.AddTransient<AppHeadersHandler>();

        builder.Services.AddHttpClient();
        
        builder.Services.AddCache();

#if IOS || MACCATALYST
        builder.Services.AddTransient<CustomSchemeHandler>();
#elif ANDROID
        builder.Services.AddTransient<CustomWebViewClient>();
#endif

        var culture = new CultureInfo("sv");
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;

        return builder.Build();
    }
}
