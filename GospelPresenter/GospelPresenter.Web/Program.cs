using System.Net.Http.Headers;
using GospelPresenter.Shared;
using GospelPresenter.Shared.HttpClients;
using GospelPresenter.Web.Components;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Services.Auth;
using GospelPresenter.Shared.Services.InitialData;
using GospelPresenter.Shared.State;
using GospelPresenter.Web.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Prometheus;
using Serilog;
using Yarp.ReverseProxy.Transforms;
using AuthService = GospelPresenter.Web.Services.Auth.AuthService;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

Log.Information("Starting up");

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Host.UseSerilog((hostBuilderContext, loggerConfiguration) => loggerConfiguration
        .ReadFrom.Configuration(hostBuilderContext.Configuration)
    );

    builder.Configuration.AddJsonFile("secrets/appsettings.secret.json",
        optional: true,
        reloadOnChange: false);

    if (builder.Environment.IsProduction())
    {
        var dataProtectionDirectory = builder.Configuration.GetSection("Settings:DataProtectionKeysDirectory").Value!;
        builder.Services.AddDataProtection()
            .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionDirectory));
    }

// Add services to the container.
    builder.Services.AddRazorComponents(options => options.DetailedErrors = builder.Environment.IsDevelopment())
        .AddInteractiveServerComponents();

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

    builder.Services.AddHealthChecks()
        .ForwardToPrometheus();

    builder.Services.UseHttpClientMetrics();

    string[] supportedCultures = ["sv"];
    builder.Services.Configure<RequestLocalizationOptions>(options =>
    {
        options.SetDefaultCulture(supportedCultures[0])
            .AddSupportedCultures(supportedCultures)
            .AddSupportedUICultures(supportedCultures);
    });
    builder.Services.AddLocalization();

    builder.Services.AddReverseProxy()
        .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))
        .AddTransforms(builderContext =>
        {
            builderContext.AddRequestTransform(context =>
            {
                var appState = context.HttpContext.RequestServices.GetRequiredService<AppState>();
                
                if (appState.LoggedInUser?.Token is not null)
                {
                    context.ProxyRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", appState.LoggedInUser.Token);
                }
                
                return new ValueTask(Task.CompletedTask);
            });
        });

#if !DEBUG
builder.Services.AddMetricServer(options =>
{
    options.Port = 1337; // Use metrics on another port, to not expose it outside the cluster
});
#endif

    var app = builder.Build();

    app.UseSerilogRequestLogging();

    app.Use((context, next) =>
    {
        context.Request.Scheme = "https";
        return next(context);
    });

    app.UseForwardedHeaders();

// Configure the HTTP request pipeline.
    if (!app.Environment.IsDevelopment())
    {
        app.UseExceptionHandler("/Error", createScopeForErrors: true);
        // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
        app.UseHsts();
    }

    app.UseHttpsRedirection();

    app.MapStaticAssets();
    app.UseAntiforgery();

    app.UseRequestLocalization(supportedCultures);

    app.MapRazorComponents<App>()
        .AddInteractiveServerRenderMode()
        .AddAdditionalAssemblies(typeof(GospelPresenter.Shared._Imports).Assembly);

    app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
    app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
    
    app.MapReverseProxy();

    // Capture metrics about all received HTTP requests.
    app.UseHttpMetrics();

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Unhandled exception");
}
finally
{
    Log.Information("Shut down complete");
    Log.CloseAndFlush();
}
