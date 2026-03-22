using GospelPresenter.MigrationService;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Configuration;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = Host.CreateApplicationBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddDbContextPool<PresentationContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("postgresdb")));

builder.Services.AddSharedGospelPresenterServices(builder.Configuration);
builder.Services.AddSingleton<GarageInitializer>();
builder.Services.AddSingleton<ImageDataMigrator>();

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

            logger.LogInformation("Migration Service is finished");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Migration Service failed");
        }

        hostLifetime.StopApplication();
    }
}
