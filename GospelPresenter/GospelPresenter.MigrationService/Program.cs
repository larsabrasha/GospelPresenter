using GospelPresenter.Shared.Contexts;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddDbContextPool<PresentationContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("postgresdb")));

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
            var context = scope.ServiceProvider.GetRequiredService<PresentationContext>();
            var strategy = context.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () => { await context.Database.MigrateAsync(stoppingToken); });
            logger.LogInformation("Migration Service is finished");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Migration Service failed");
        }

        hostLifetime.StopApplication();
    }
}
