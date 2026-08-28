using GospelPresenter.Client.Data;
using GospelPresenter.Configuration;
using GospelPresenter.Services;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Authorization;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.EntityFrameworkCore;
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
        builder.Services.AddSingleton<IAppCapabilities, DeviceAppCapabilities>();
        builder.Services.AddSingleton<IStatusBarService, StatusBarService>();

        builder.Services.AddHttpClient();

        // The local database: the full shared schema in SQLite under the app's data directory.
        // Every shared domain service runs against it unchanged through the factory below.
        var databasePath = Path.Combine(FileSystem.Current.AppDataDirectory, "gospelpresenter.db");
        var contextOptions = new DbContextOptionsBuilder<ClientDataContext>()
            .UseSqlite($"Data Source={databasePath};Cache=Shared")
            .Options;
        var contextFactory = new ClientDataContextFactory(contextOptions);
        builder.Services.AddSingleton<IDbContextFactory<PresentationContext>>(contextFactory);
        builder.Services.AddSingleton<IDbContextFactory<ClientDataContext>>(contextFactory);
        builder.Services.AddSingleton<ClientDatabaseInitializer>();

        // The same domain services, with the same lifetimes, the web host registers — they only
        // see IDbContextFactory<PresentationContext> and cannot tell SQLite from Postgres.
        builder.Services.AddMemoryCache();
        builder.Services.AddScoped<IPresentationService, PresentationService>();
        builder.Services.AddSingleton<ISongService, SongService>();
        builder.Services.AddSingleton<IBibleService, BibleService>();
        builder.Services.AddScoped<IUserService, UserService>();
        builder.Services.AddScoped<IOnboardingService, OnboardingService>();
        builder.Services.AddScoped<IOrganizationImageService, OrganizationImageService>();
        builder.Services.AddScoped<IOrganizationAudioService, OrganizationAudioService>();
        builder.Services.AddScoped<IOrganizationSettingService, OrganizationSettingService>();
        builder.Services.AddSingleton<ICcliReportService, CcliReportService>();
        builder.Services.AddSingleton<Shared.Services.IPdfRenderService, PdfRenderService>();
        builder.Services.AddScoped<IPresentationSlidesService, PresentationSlidesService>();
        builder.Services.AddScoped<ICalendarFeedService, CalendarFeedService>();

        // Unconfigured on the device: IsConfigured stays false and the PowerPoint import UI
        // disables itself, exactly like a web deployment without Gotenberg.
        builder.Services.AddHttpClient(GotenbergPowerPointConverter.HttpClientName);
        builder.Services.AddSingleton<IPowerPointConverter, GotenbergPowerPointConverter>();

        // The local media store replaces the NullObjectStorageService the shared setup registered:
        // the domain services upload and delete blobs against local disk, and the gpmedia://
        // scheme handler (registered per webview in MainPage) serves them back to the UI.
        builder.Services.AddSingleton(sp => new GospelPresenter.Client.Media.MediaStore(
            sp.GetRequiredService<IDbContextFactory<GospelPresenter.Client.Data.ClientDataContext>>(),
            Path.Combine(FileSystem.Current.AppDataDirectory, "media"),
            sp.GetRequiredService<ILogger<GospelPresenter.Client.Media.MediaStore>>()));
        builder.Services.AddSingleton<IObjectStorageService, GospelPresenter.Client.Media.LocalObjectStorageService>();
        builder.Services.AddSingleton<GospelPresenter.Client.Media.MediaRequestHandler>();

        // Uploads reach the library through the domain services instead of the web's /api/upload
        // endpoints, which do not exist here — see IMediaUploader.
        builder.Services.AddScoped<IMediaUploader, MauiMediaUploader>();
#if IOS || MACCATALYST
        // Components mint media URLs on the app's custom scheme instead of the web's /api paths.
        ImageUrlHelper.HostUrlTransform = url => "gpmedia://media" + url;
#endif

        builder.Services.AddCascadingAuthenticationState();
        builder.Services.AddPermissionAuthorization();

        // The web host's CCLI hosted service, as a plain singleton (started below): displayed
        // songs become local report rows the sync engine pushes.
        builder.Services.AddSingleton<GospelPresenter.Client.CcliReportListener>();

        // The projector: live views open as real second windows instead of the web's window.open,
        // auto-placed fullscreen on the external screen where the platform can (Mac Catalyst).
#if MACCATALYST
        builder.Services.AddSingleton<IExternalDisplayService, MacExternalDisplayService>();
#else
        builder.Services.AddSingleton<IExternalDisplayService, NullExternalDisplayService>();
#endif
        builder.Services.AddSingleton<Shared.Services.ILiveWindowLauncher, MauiLiveWindowLauncher>();

        // Real sign-in: system browser → device token → identity cached for offline. A DEBUG
        // build with no server URL configured runs a fixed developer identity instead, so local
        // development works without any server at all.
#if DEBUG
        var useDevIdentity = string.IsNullOrEmpty(Configuration.Settings.ApiBaseUrl);
#else
        const bool useDevIdentity = false;
#endif
        builder.Services.AddSingleton<GospelPresenter.Client.Auth.ISecureTokenStore, MauiSecureTokenStore>();
        builder.Services.AddSingleton(sp => new GospelPresenter.Client.Auth.DeviceAuthService(
            sp.GetRequiredService<GospelPresenter.Client.Auth.ISecureTokenStore>(),
            Path.Combine(FileSystem.Current.AppDataDirectory, "identity.json"),
            sp.GetRequiredService<ILogger<GospelPresenter.Client.Auth.DeviceAuthService>>()));
        builder.Services.AddSingleton<IDeviceSignIn, DeviceSignInService>();
        if (useDevIdentity)
            builder.Services.AddScoped<AuthenticationStateProvider, DevAuthenticationStateProvider>();
        else
            builder.Services.AddScoped<AuthenticationStateProvider, GospelPresenter.Client.Auth.DeviceAuthStateProvider>();

        // The sync engine: push/pull against the server over the device token, scheduled on app
        // start, connectivity changes and local edits. Nothing of this exists in dev-identity mode
        // — there is no server to sync against, and the status indicator stays hidden.
        if (!useDevIdentity)
        {
            builder.Services.AddTransient<GospelPresenter.Client.Auth.DeviceTokenHandler>();
            builder.Services.AddHttpClient(GospelPresenter.Client.Sync.ClientSyncService.HttpClientName,
                    client => client.BaseAddress = new Uri(Configuration.Settings.ApiBaseUrl!))
                .AddHttpMessageHandler<GospelPresenter.Client.Auth.DeviceTokenHandler>()
                // The Bible download endpoint gzips its megabytes of JSON when asked.
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
                {
                    AutomaticDecompression = System.Net.DecompressionMethods.All,
                });

            builder.Services.AddSingleton<GospelPresenter.Client.Sync.ISyncCacheRefresher,
                GospelPresenter.Client.Sync.SharedCacheRefresher>();
            builder.Services.AddSingleton<GospelPresenter.Client.Sync.IConnectivityMonitor, MauiConnectivityMonitor>();
            builder.Services.AddSingleton(sp => new GospelPresenter.Client.Sync.ClientSyncService(
                sp.GetRequiredService<IDbContextFactory<GospelPresenter.Client.Data.ClientDataContext>>(),
                sp.GetRequiredService<IHttpClientFactory>().CreateClient(GospelPresenter.Client.Sync.ClientSyncService.HttpClientName),
                sp.GetRequiredService<GospelPresenter.Client.Sync.ISyncCacheRefresher>(),
                sp.GetRequiredService<GospelPresenter.Client.Auth.DeviceAuthService>(),
                DeviceInfo.Current.Name,
                sp.GetRequiredService<ILogger<GospelPresenter.Client.Sync.ClientSyncService>>()));
            builder.Services.AddSingleton<GospelPresenter.Client.Sync.SyncScheduler>();
            builder.Services.AddSingleton<Shared.Services.ISyncStatusSource>(sp =>
                sp.GetRequiredService<GospelPresenter.Client.Sync.SyncScheduler>());

            // Blobs: pending local uploads go to PUT /api/sync/media, and the pin set (media the
            // local presentations reference) is downloaded and kept, after every metadata sync.
            builder.Services.AddSingleton<GospelPresenter.Client.Media.IMediaDownloader>(sp =>
                new GospelPresenter.Client.Media.HttpMediaDownloader(
                    sp.GetRequiredService<IHttpClientFactory>().CreateClient(GospelPresenter.Client.Sync.ClientSyncService.HttpClientName),
                    sp.GetRequiredService<ILogger<GospelPresenter.Client.Media.HttpMediaDownloader>>()));
            builder.Services.AddSingleton<GospelPresenter.Client.Media.MediaPinService>();

            // Opt-in offline Bible translations: downloaded on request from the Bibles page,
            // refreshed after syncs when the server-side translation changed.
            builder.Services.AddSingleton(sp => new GospelPresenter.Client.Bibles.BibleOfflineService(
                sp.GetRequiredService<IDbContextFactory<GospelPresenter.Client.Data.ClientDataContext>>(),
                sp.GetRequiredService<IHttpClientFactory>().CreateClient(GospelPresenter.Client.Sync.ClientSyncService.HttpClientName),
                sp.GetRequiredService<IBibleService>(),
                sp.GetRequiredService<ILogger<GospelPresenter.Client.Bibles.BibleOfflineService>>()));
            builder.Services.AddSingleton<IBibleOfflineStore>(sp =>
                sp.GetRequiredService<GospelPresenter.Client.Bibles.BibleOfflineService>());

            builder.Services.AddSingleton<GospelPresenter.Client.Media.IMediaSynchronizer>(sp =>
                new GospelPresenter.Client.Media.MediaSynchronizer(
                    sp.GetRequiredService<GospelPresenter.Client.Media.MediaStore>(),
                    sp.GetRequiredService<IHttpClientFactory>().CreateClient(GospelPresenter.Client.Sync.ClientSyncService.HttpClientName),
                    sp.GetRequiredService<GospelPresenter.Client.Media.MediaPinService>(),
                    sp.GetRequiredService<ILogger<GospelPresenter.Client.Media.MediaSynchronizer>>(),
                    sp.GetRequiredService<GospelPresenter.Client.Bibles.BibleOfflineService>()));
        }
        else
        {
            // No server to fetch from: the store serves what exists locally, nothing more.
            builder.Services.AddSingleton<GospelPresenter.Client.Media.IMediaDownloader,
                GospelPresenter.Client.Media.NullMediaDownloader>();
        }

        var deviceLang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        var culture = deviceLang == "sv" ? new CultureInfo("sv") : new CultureInfo("en");
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;

        var app = builder.Build();
        InitializeDatabase(app.Services, seedDevIdentity: useDevIdentity);
        app.Services.GetRequiredService<GospelPresenter.Client.CcliReportListener>().Start();

        if (!useDevIdentity)
        {
            // Restore the persisted sign-in before first paint, so a signed-in user never
            // flashes past the login page.
            var auth = app.Services.GetRequiredService<GospelPresenter.Client.Auth.DeviceAuthService>();
            Task.Run(() => auth.LoadAsync()).GetAwaiter().GetResult();

            // Catch up with the server in the background, and keep watching for local edits and
            // connectivity from here on.
            app.Services.GetRequiredService<GospelPresenter.Client.Sync.SyncScheduler>().Start();
        }

        return app;
    }

    /// <summary>
    /// Migrations and triggers block startup — the UI must not touch a half-upgraded database —
    /// while the singleton in-memory caches load in the background, since first paint can happen
    /// without them. The web host does the same work in Program.cs at startup.
    /// </summary>
    private static void InitializeDatabase(IServiceProvider services, bool seedDevIdentity)
    {
        var initializer = services.GetRequiredService<ClientDatabaseInitializer>();
        Task.Run(() => initializer.InitializeAsync()).GetAwaiter().GetResult();

#if DEBUG
        if (seedDevIdentity)
            SeedDevIdentity(services);
#endif

        _ = Task.Run(async () =>
        {
            try
            {
                await services.GetRequiredService<ISongService>().LoadSongsAsync();
                await services.GetRequiredService<IBibleService>().LoadBiblesAsync();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to load the in-memory caches at startup");
            }
        });
    }

#if DEBUG
    /// <summary>
    /// TEMPORARY until the device-token login lands: the rows behind
    /// <see cref="DevAuthenticationStateProvider"/>, so the app boots to a working dashboard.
    /// </summary>
    private static void SeedDevIdentity(IServiceProvider services)
    {
        var factory = services.GetRequiredService<IDbContextFactory<PresentationContext>>();
        using var context = factory.CreateDbContext();

        if (!context.Organizations.Any(o => o.Id == DevAuthenticationStateProvider.OrganizationId))
        {
            context.Organizations.Add(new Shared.Models.Organization
            {
                Id = DevAuthenticationStateProvider.OrganizationId,
                Name = "Utvecklingsmiljö",
            });
        }

        if (!context.Users.Any(u => u.Id == DevAuthenticationStateProvider.UserId))
        {
            context.Users.Add(new Shared.Models.User
            {
                Id = DevAuthenticationStateProvider.UserId,
                Name = "Utvecklare",
                Email = "dev@example.com",
                Role = Shared.Models.UserRole.Admin,
                OrganizationId = DevAuthenticationStateProvider.OrganizationId,
            });
        }

        context.SaveChanges();
    }
#endif
}
