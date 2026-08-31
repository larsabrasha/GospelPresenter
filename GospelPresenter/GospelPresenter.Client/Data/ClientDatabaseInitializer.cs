using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Data;

/// <summary>
/// Brings the local database up to date at app startup: applies the SQLite migration set,
/// (re)installs the sync journal triggers, and seeds the built-in themes so first run works
/// offline. Migrations, never recreate-on-drift: the device holds offline edits that must
/// survive every upgrade.
/// </summary>
public class ClientDatabaseInitializer(
    IDbContextFactory<ClientDataContext> contextFactory,
    ILogger<ClientDatabaseInitializer> logger)
{
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);

        var pending = (await context.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
        if (pending.Count > 0)
        {
            logger.LogInformation("Applying {Count} local database migrations: {Migrations}",
                pending.Count, string.Join(", ", pending));
            await context.Database.MigrateAsync(cancellationToken);
        }

        await Sync.SyncTriggerInstaller.InstallAsync(context, cancellationToken);
        await BuiltInThemeSeeder.SeedAsync(context, cancellationToken);
    }
}
