using GospelPresenter.Shared.Contexts;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Client.Data;

/// <summary>
/// The MAUI app's local database: the full shared schema (every domain service runs against it
/// unchanged, via a factory that hands out this context as PresentationContext) plus the client's
/// own bookkeeping — sync state, the change journal the triggers write, and the media cache
/// ledger. Schema changes reach devices through the SQLite migration set in this project; the
/// Npgsql migrations in Shared are the server's. Every model change therefore needs both.
/// </summary>
public class ClientDataContext(DbContextOptions<ClientDataContext> options) : PresentationContext(options)
{
    public DbSet<SyncStateEntry> SyncState { get; set; }
    public DbSet<SyncJournalEntry> SyncJournal { get; set; }
    public DbSet<SyncBaseEntry> SyncBase { get; set; }
    public DbSet<MediaCacheEntry> MediaCache { get; set; }

    /// <summary>
    /// Set by the sync engine while it writes server rows locally: rows must keep the server's
    /// ModifiedAt, and deletes driven by tombstones must not mint local tombstones. The SQLite
    /// triggers have their own guard (SyncState['applying']); this silences the EF side.
    /// </summary>
    public bool ApplyingServerChanges { get; set; }

    protected override bool SuppressSyncTracking => ApplyingServerChanges;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<SyncStateEntry>(e =>
        {
            e.ToTable(SyncStateEntry.TableName);
            e.HasKey(s => s.Key);
        });

        modelBuilder.Entity<SyncBaseEntry>(e =>
        {
            e.ToTable("SyncBase");
            e.HasKey(b => new { b.EntityTable, b.RowId });
        });

        modelBuilder.Entity<SyncJournalEntry>(e =>
        {
            e.ToTable(SyncJournalEntry.TableName);
            e.HasIndex(j => new { j.EntityTable, j.RowId });
        });

        modelBuilder.Entity<MediaCacheEntry>(e =>
        {
            e.HasKey(m => m.Key);
            e.Property(m => m.State).HasConversion<string>();
            e.HasIndex(m => new { m.Pinned, m.LastAccessAt });
            e.HasIndex(m => m.State);
        });
    }
}
