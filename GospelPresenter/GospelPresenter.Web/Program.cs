using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Web.Components;
using GospelPresenter.Shared.Services;
using GospelPresenter.Web.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Prometheus;
using GospelPresenter.Web.Configuration;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

Log.Information("Starting up");

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.AddServiceDefaults();

    builder.Host.UseSerilog((hostBuilderContext, loggerConfiguration) => loggerConfiguration
        .ReadFrom.Configuration(hostBuilderContext.Configuration)
    );

    builder.Services.Configure<Settings>(builder.Configuration.GetSection("Settings"));

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
    builder.Services.AddSingleton<IStatusBarService, StatusBarService>();

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

    builder.Services.AddDbContextFactory<PresentationContext>(opt =>
        opt.UseNpgsql(builder.Configuration.GetConnectionString("postgresdb")));

    builder.Services.AddScoped<IPresentationService, PresentationService>();

#if !DEBUG
builder.Services.AddMetricServer(options =>
{
    options.Port = 1337; // Use metrics on another port, to not expose it outside the cluster
});
#endif

    var app = builder.Build();

    var biblesPath = app.Configuration.GetSection("Settings:BiblesPath").Value;
    if (!string.IsNullOrEmpty(biblesPath))
    {
        var bibleService = app.Services.GetRequiredService<IBibleService>();
        bibleService.LoadBibles(biblesPath);
    }

    app.MapDefaultEndpoints();

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
