using System.Globalization;
using System.Net;
using System.Reflection;
using ElectronNET.API;
using ElectronNET.API.Entities;
using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Client.Sync;
using GospelPresenter.Desktop;
using GospelPresenter.Desktop.Services;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Authorization;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Serilog.Events;

// The desktop host: ASP.NET Core serving the shared Blazor components over localhost, inside an
// Electron window. Registrations mirror what MauiProgram did, because the app is the same app —
// what changes is the shell around it and, with a real local HTTP server, the fact that media no
// longer needs a custom URL scheme per platform.

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("System.Net.Http.HttpClient", LogEventLevel.Warning)
    .MinimumLevel.Override("ZiggyCreatures.Caching.Fusion", LogEventLevel.Warning)
    .MinimumLevel.Override("GospelPresenter", LogEventLevel.Debug)
    .WriteTo.Console()
    .WriteTo.File(Path.Combine(DesktopPaths.LogDirectory, "log.txt"),
        rollingInterval: RollingInterval.Day,
        fileSizeLimitBytes: 10_000_000,
        retainedFileCountLimit: 7)
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog();

// Electron takes over process lifetime and opens the window once the host is listening. The
// callback is where the UI is set up — new in the Core line, and the reason the window can be
// created without racing the server's startup. It runs after Build(), so the container below is
// available to it by then.
IServiceProvider? electronServices = null;
builder.WebHost.UseElectron(args, () => OnElectronReadyAsync(electronServices!));

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

// Empty means no server: the app then runs the developer identity and none of the sync below,
// exactly as the MAUI host's Local scheme does.
var apiBaseUrl = DesktopSettings.ResolveApiBaseUrl(builder.Configuration);

builder.Services.AddSharedGospelPresenterServices();
builder.Services.AddSingleton<IAppCapabilities, DesktopAppCapabilities>();
builder.Services.AddSingleton<IStatusBarService, DesktopStatusBarService>();
builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();

// The local database: the full shared schema in SQLite under the app's data directory. Every
// shared domain service runs against it unchanged through the factory below.
var databasePath = Path.Combine(DesktopPaths.DataDirectory, "gospelpresenter.db");
var contextOptions = new DbContextOptionsBuilder<ClientDataContext>()
    .UseSqlite($"Data Source={databasePath};Cache=Shared")
    .Options;
var contextFactory = new ClientDataContextFactory(contextOptions);
builder.Services.AddSingleton<IDbContextFactory<PresentationContext>>(contextFactory);
builder.Services.AddSingleton<IDbContextFactory<ClientDataContext>>(contextFactory);
builder.Services.AddSingleton<ClientDatabaseInitializer>();

// The same domain services, with the same lifetimes, the web host registers — they only see
// IDbContextFactory<PresentationContext> and cannot tell SQLite from Postgres.
builder.Services.AddScoped<IPresentationService, PresentationService>();
builder.Services.AddSingleton<ISongService, SongService>();
builder.Services.AddSingleton<IBibleService, BibleService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IOnboardingService, OnboardingService>();
builder.Services.AddScoped<IOrganizationImageService, OrganizationImageService>();
builder.Services.AddScoped<IOrganizationAudioService, OrganizationAudioService>();
builder.Services.AddScoped<IOrganizationSettingService, OrganizationSettingService>();
builder.Services.AddSingleton<ICcliReportService, CcliReportService>();
builder.Services.AddSingleton<IPdfRenderService, PdfRenderService>();
builder.Services.AddScoped<IPresentationSlidesService, PresentationSlidesService>();
builder.Services.AddScoped<ICalendarFeedService, CalendarFeedService>();

// Unconfigured here, exactly like a web deployment without Gotenberg: IsConfigured stays false and
// the PowerPoint import UI disables itself.
builder.Services.AddHttpClient(GotenbergPowerPointConverter.HttpClientName);
builder.Services.AddSingleton<IPowerPointConverter, GotenbergPowerPointConverter>();

// Blobs on local disk. Unlike the MAUI host there is no custom URL scheme to register: the app is
// served over HTTP, so ImageUrlHelper's default /api paths resolve against our own server.
builder.Services.AddSingleton(sp => new GospelPresenter.Client.Media.MediaStore(
    sp.GetRequiredService<IDbContextFactory<ClientDataContext>>(),
    Path.Combine(DesktopPaths.DataDirectory, "media"),
    sp.GetRequiredService<ILogger<GospelPresenter.Client.Media.MediaStore>>()));
builder.Services.AddSingleton<IObjectStorageService, GospelPresenter.Client.Media.LocalObjectStorageService>();
builder.Services.AddSingleton<GospelPresenter.Client.Media.MediaRequestHandler>();

// Uploads reach the library through the domain services instead of the web's /api/upload endpoints,
// which do not exist here — see IMediaUploader.
builder.Services.AddScoped<MediaIngestService>();
builder.Services.AddScoped<IMediaUploader, ElectronMediaUploader>();

// The device's identity, and the two faces it is asked for. DeviceAuthStateProvider answers
// Blazor; DeviceAuthenticationHandler answers the HTTP pipeline, which the MAUI host did not have
// and which sees [Authorize] on a page component as [Authorize] on an endpoint.
builder.Services.AddCascadingAuthenticationState();
builder.Services.AddPermissionAuthorization();
// Only a real installation gets the real store. With no server the token is made up, and writing it
// where a later server-configured run would find it is what would make that identity leak — see
// InMemoryTokenStore.
if (apiBaseUrl.Length > 0)
    builder.Services.AddSingleton<ISecureTokenStore, DesktopSecureTokenStore>();
else
    builder.Services.AddSingleton<ISecureTokenStore, InMemoryTokenStore>();

builder.Services.AddSingleton(sp => new DeviceAuthService(
    sp.GetRequiredService<ISecureTokenStore>(),
    Path.Combine(DesktopPaths.DataDirectory, "identity.json"),
    sp.GetRequiredService<ILogger<DeviceAuthService>>()));
builder.Services.AddScoped<AuthenticationStateProvider, DeviceAuthStateProvider>();
builder.Services.AddAuthentication(DeviceAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, DeviceAuthenticationHandler>(
        DeviceAuthenticationHandler.SchemeName, _ => { });

builder.Services.AddSingleton(sp => new ElectronDeviceSignIn(
    sp.GetRequiredService<DeviceAuthService>(),
    sp.GetRequiredService<IHttpClientFactory>(),
    apiBaseUrl,
    sp.GetRequiredService<ILogger<ElectronDeviceSignIn>>()));
builder.Services.AddSingleton<IDeviceSignIn>(sp => sp.GetRequiredService<ElectronDeviceSignIn>());

builder.Services.AddSingleton<GospelPresenter.Client.CcliReportListener>();

// The sync engine: push and pull over the device token, scheduled on start, on connectivity
// changes and on local edits. None of it exists without a server — there would be nothing to sync
// against, and the status indicator stays hidden.
if (apiBaseUrl.Length > 0)
{
    builder.Services.AddTransient(sp => new DeviceTokenHandler(
        sp.GetRequiredService<DeviceAuthService>(),
        typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? "0.0"));
    builder.Services.AddHttpClient(ClientSyncService.HttpClientName,
            client => client.BaseAddress = new Uri(apiBaseUrl))
        .AddHttpMessageHandler<DeviceTokenHandler>()
        // The Bible download endpoint gzips its megabytes of JSON when asked.
        .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
        });

    builder.Services.AddSingleton<ISyncCacheRefresher, SharedCacheRefresher>();
    builder.Services.AddSingleton<IConnectivityMonitor, DesktopConnectivityMonitor>();
    builder.Services.AddSingleton(sp => new ClientSyncService(
        sp.GetRequiredService<IDbContextFactory<ClientDataContext>>(),
        sp.GetRequiredService<IHttpClientFactory>().CreateClient(ClientSyncService.HttpClientName),
        sp.GetRequiredService<ISyncCacheRefresher>(),
        sp.GetRequiredService<DeviceAuthService>(),
        Environment.MachineName,
        sp.GetRequiredService<ILogger<ClientSyncService>>()));
    builder.Services.AddSingleton<SyncScheduler>();
    builder.Services.AddSingleton<ISyncStatusSource>(sp => sp.GetRequiredService<SyncScheduler>());

    // Blobs: pending local uploads go to PUT /api/sync/media, and the pin set — media the local
    // presentations reference — is downloaded and kept after every metadata sync.
    builder.Services.AddSingleton<GospelPresenter.Client.Media.IMediaDownloader>(sp =>
        new GospelPresenter.Client.Media.HttpMediaDownloader(
            sp.GetRequiredService<IHttpClientFactory>().CreateClient(ClientSyncService.HttpClientName),
            sp.GetRequiredService<ILogger<GospelPresenter.Client.Media.HttpMediaDownloader>>()));
    builder.Services.AddSingleton<GospelPresenter.Client.Media.MediaPinService>();

    // Opt-in offline Bible translations: downloaded on request from the Bibles page, refreshed
    // after syncs when the server-side translation changed.
    builder.Services.AddSingleton(sp => new GospelPresenter.Client.Bibles.BibleOfflineService(
        sp.GetRequiredService<IDbContextFactory<ClientDataContext>>(),
        sp.GetRequiredService<IHttpClientFactory>().CreateClient(ClientSyncService.HttpClientName),
        sp.GetRequiredService<IBibleService>(),
        sp.GetRequiredService<ILogger<GospelPresenter.Client.Bibles.BibleOfflineService>>()));
    builder.Services.AddSingleton<IBibleOfflineStore>(sp =>
        sp.GetRequiredService<GospelPresenter.Client.Bibles.BibleOfflineService>());

    builder.Services.AddSingleton<GospelPresenter.Client.Media.IMediaSynchronizer>(sp =>
        new GospelPresenter.Client.Media.MediaSynchronizer(
            sp.GetRequiredService<GospelPresenter.Client.Media.MediaStore>(),
            sp.GetRequiredService<IHttpClientFactory>().CreateClient(ClientSyncService.HttpClientName),
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

// The projector window. The web falls back to window.open when this is missing; here there is a
// real second window, and a real second display to put it on.
builder.Services.AddSingleton<ILiveWindowLauncher, ElectronLiveWindowLauncher>();

var culture = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "sv"
    ? new CultureInfo("sv")
    : new CultureInfo("en");
CultureInfo.DefaultThreadCurrentCulture = culture;
CultureInfo.DefaultThreadCurrentUICulture = culture;

var app = builder.Build();
electronServices = app.Services;

// Blazor's interactive server components carry anti-forgery metadata, and the endpoint middleware
// refuses to serve them without this. Nothing in the desktop app posts a form cross-origin, but the
// requirement is structural rather than a judgement about risk.
app.UseAntiforgery();
app.MapStaticAssets();
app.MapRazorComponents<GospelPresenter.Desktop.Components.App>()
    .AddInteractiveServerRenderMode()
    .AddAdditionalAssemblies(typeof(GospelPresenter.Shared._Imports).Assembly);

// Media. Components render the same /api paths the web serves — ImageUrlHelper.HostUrlTransform is
// left alone here, unlike the MAUI host, because there is a real HTTP server to answer them. The
// paths are routed straight to MediaRequestHandler, which already knows how to turn one into an
// object key and read the blob out of the local store.
foreach (var prefix in new[] { "/api/images", "/api/live-images", "/api/audio", "/api/theme-images" })
    app.MapGet($"{prefix}/{{**rest}}", ServeMediaAsync);

await InitialiseDatabaseAsync(app.Services);
app.Services.GetRequiredService<GospelPresenter.Client.CcliReportListener>().Start();

if (apiBaseUrl.Length > 0)
{
    // Restore the persisted sign-in before first paint, so a signed-in user never flashes past the
    // login page, then catch up with the server in the background.
    await app.Services.GetRequiredService<DeviceAuthService>().LoadAsync();
    app.Services.GetRequiredService<SyncScheduler>().Start();
}
else
{
    await DevIdentity.SeedAsync(app.Services);
}

await app.RunAsync();

/// <summary>
/// Answers one media request out of the local store. Audio needs the range half: a player cannot
/// seek in a response that ignores its Range header, it can only restart from the beginning.
/// </summary>
static async Task ServeMediaAsync(HttpContext http, GospelPresenter.Client.Media.MediaRequestHandler media)
{
    var result = await media.HandleAsync(
        http.Request.Path.Value ?? "",
        http.Request.Headers.Range,
        http.RequestAborted);

    if (result is null)
    {
        http.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    http.Response.StatusCode = result.Status;
    http.Response.ContentType = result.ContentType;
    http.Response.Headers.AcceptRanges = "bytes";
    if (result.ContentRange is not null)
        http.Response.Headers.ContentRange = result.ContentRange;

    await http.Response.Body.WriteAsync(result.Data, http.RequestAborted);
}

/// <summary>
/// Migrations and triggers block startup — the UI must not touch a half-upgraded database — while
/// the in-memory caches load in the background, since first paint can happen without them. The web
/// host and the MAUI host both do the same.
/// </summary>
static async Task InitialiseDatabaseAsync(IServiceProvider services)
{
    await services.GetRequiredService<ClientDatabaseInitializer>().InitializeAsync();

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

/// <summary>
/// Opens the operator window once the host is listening. The projector window is not created here:
/// it belongs to ILiveWindowLauncher, which opens one on demand when a presentation goes live.
/// </summary>
static async Task OnElectronReadyAsync(IServiceProvider services)
{
    // Claim gospelpresenter:// before anything can sign in on it. Doing this here rather than at
    // registration is not incidental: both halves talk to Electron, which does not exist until now.
    await services.GetRequiredService<ElectronDeviceSignIn>().InitialiseAsync();

    var displays = await Electron.Screen.GetAllDisplaysAsync();
    Log.Information("Electron ready, {Count} display(s)", displays.Length);
    foreach (var display in displays)
        Log.Information("  display {Id} bounds={X},{Y} {W}x{H}",
            display.Id, display.Bounds.X, display.Bounds.Y, display.Bounds.Width, display.Bounds.Height);

    var window = await Electron.WindowManager.CreateWindowAsync(new BrowserWindowOptions
    {
        Title = "Gospel Presenter",
        Width = 1280,
        Height = 860,
        MinWidth = 900,
        MinHeight = 600,
        Show = false,
        AutoHideMenuBar = true,
    });

    window.OnReadyToShow += () => window.Show();
    window.OnClosed += () => Electron.App.Quit();
}
