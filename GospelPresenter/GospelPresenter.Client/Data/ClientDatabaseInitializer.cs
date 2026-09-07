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

        // The UI, the sync scheduler and the media downloader all open contexts on this one file. In
        // the default rollback journal a reader blocks a writer and the other way round; in WAL
        // mode they do not, and the pull applier's one large write transaction stops stalling
        // whoever is reading the song list. Persistent on the file, so setting it every start is a
        // cheap no-op after the first.
        await context.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;", cancellationToken);

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
