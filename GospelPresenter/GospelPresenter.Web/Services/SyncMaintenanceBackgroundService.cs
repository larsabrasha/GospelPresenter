using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Web.Services;

/// <summary>
/// Purges sync tombstones older than the retention window. A client whose pull watermark predates
/// the purge horizon can no longer learn about every deletion incrementally; the pull endpoint
/// answers such clients with <c>requiresFullResync</c>, so purging here is safe as long as the
/// horizon it advertises stays inside <see cref="Retention"/>.
/// </summary>
public class SyncMaintenanceBackgroundService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    ILogger<SyncMaintenanceBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var context = await dbContextFactory.CreateDbContextAsync(stoppingToken);
                var cutoff = DateTimeOffset.UtcNow - SyncTombstone.Retention;
                var purged = await context.SyncTombstones
                    .Where(t => t.DeletedAt < cutoff)
                    .ExecuteDeleteAsync(stoppingToken);

                if (purged > 0)
                    logger.LogInformation("Purged {Count} sync tombstones older than {Cutoff}", purged, cutoff);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Sync tombstone purge failed");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
