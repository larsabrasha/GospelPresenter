using GospelPresenter.MigrationService;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Configuration;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = Host.CreateApplicationBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddPooledDbContextFactory<PresentationContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("postgresdb")));

builder.Services.AddSharedGospelPresenterServices(builder.Configuration);
builder.Services.AddSingleton<GarageInitializer>();
builder.Services.AddSingleton<ImageDataMigrator>();
builder.Services.AddSingleton<ThemeAssetUploader>();

builder.Services.AddHostedService<MigrationService>();

var host = builder.Build();
host.Run();

internal class MigrationService(
    IServiceProvider serviceProvider,
    IHostApplicationLifetime hostLifetime,
    ILogger<MigrationService> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Migration Service is starting");

        using var scope = serviceProvider.CreateScope();

        try
        {
            // Initialize Garage (node layout, API key, bucket)
            var s3Options = scope.ServiceProvider.GetService<IOptions<S3Options>>()?.Value;
            if (s3Options is not null && !string.IsNullOrEmpty(s3Options.AdminEndpoint))
            {
                try
                {
                    var garageInit = scope.ServiceProvider.GetRequiredService<GarageInitializer>();
                    await garageInit.InitializeAsync(s3Options, stoppingToken);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Garage initialization failed — S3 image migration will be skipped");
                }
            }

            var context = scope.ServiceProvider.GetRequiredService<PresentationContext>();
            var strategy = context.Database.CreateExecutionStrategy();

            // Migrate existing image data to S3 before EF migration drops the columns
            var storage = scope.ServiceProvider.GetService<IObjectStorageService>();
            if (storage is not null)
            {
                try
                {
                    await strategy.ExecuteAsync(async () =>
                    {
                        var migrator = scope.ServiceProvider.GetRequiredService<ImageDataMigrator>();
                        await migrator.MigrateAsync(storage, context, stoppingToken);
                    });
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Image data migration to S3 failed — will retry on next startup");
                }
            }

            // Apply EF migrations
            await strategy.ExecuteAsync(async () =>
            {
                await context.Database.MigrateAsync(stoppingToken);
            });

            // The built-in themes live in code and are upserted after every migration, so improving
            // one ships with the application instead of requiring a migration of its own.
            await strategy.ExecuteAsync(async () =>
            {
                await BuiltInThemeSeeder.SeedAsync(context, stoppingToken);
            });

            // Their background art is copied to object storage for delivery. Not fatal if it fails: the
            // endpoint falls back to the copy embedded in the application.
            if (storage is not null)
            {
                try
                {
                    var uploader = scope.ServiceProvider.GetRequiredService<ThemeAssetUploader>();
                    await uploader.UploadAsync(storage, stoppingToken);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Theme asset upload failed — assets will be served from the application");
                }
            }

            logger.LogInformation("Migration Service is finished");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Migration Service failed");
        }

        hostLifetime.StopApplication();
    }
}
