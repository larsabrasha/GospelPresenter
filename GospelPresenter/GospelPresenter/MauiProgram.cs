using GospelPresenter.Configuration;
using GospelPresenter.Services;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging;
using Serilog;
using Serilog.Events;
using System.Globalization;

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
            .ConfigureFonts(fonts => { fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular"); });

        builder.Services.AddSerilog();

        builder.Services.AddMauiBlazorWebView();

// #if DEBUG
        builder.Services.AddBlazorWebViewDeveloperTools();
        builder.Logging.AddDebug();
// #endif

        builder.Services.AddSharedGospelPresenterServices();
        builder.Services.AddSingleton<IStatusBarService, StatusBarService>();

        builder.Services.AddHttpClient();
        
        var deviceLang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        var culture = deviceLang == "sv" ? new CultureInfo("sv") : new CultureInfo("en");
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;

        return builder.Build();
    }
}
