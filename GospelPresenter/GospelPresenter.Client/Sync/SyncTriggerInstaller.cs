using GospelPresenter.Client.Data;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Installs the SQLite triggers that journal every local change into SyncJournal. Triggers rather
/// than EF machinery, because the domain services also mutate rows with ExecuteUpdate and
/// ExecuteDelete — statements no interceptor or SaveChanges override ever sees. Triggers catch
/// those, and every future code path, unconditionally.
///
/// The WHEN guard is the echo suppression: while a pull is being applied, the sync engine sets
/// SyncState['applying'] = '1' inside the same transaction, so server rows being written locally
/// are not journaled back as local edits.
///
/// Child tables journal their parent foreign key too, so the push builder can resolve a journal
/// row to its aggregate root even after the row itself was deleted.
///
/// Installation drops and recreates every trigger at each startup (after migrations), so a new app
/// version's trigger SQL always replaces what an older version installed. All of it in one
/// transaction: SQLite makes DDL transactional, so the window in which some triggers are installed
/// and others are not never becomes visible to anything else, and the 86 statements cost one disk
/// sync rather than 86 on the path that blocks the first paint.
/// </summary>
public static class SyncTriggerInstaller
{
    /// <summary>
    /// The bidirectionally synced tables, with the column naming the aggregate parent for child
    /// tables (null for roots). Themes are pull-only, SongVersions and Bibles have no upstream
    /// path in v1, and CcliReportEntries are handled separately below.
    /// </summary>
    private static readonly (string Table, string? ParentColumn)[] SyncedTables =
    [
        ("Presentations", null),
        ("PresentationItems", "PresentationId"),
        ("PresentationItemParts", "PresentationItemId"),
        ("PresentationSlides", "PresentationId"),
        ("Songs", null),
        ("SongParts", "SongId"),
        ("SongArrangements", "SongId"),
        ("SongPartLabels", null),
        ("OverlaySlides", null),
        ("OrganizationImages", null),
        ("OrganizationAudios", null),
        ("OrganizationSettings", null),
        ("UserSettings", null),
        ("RemoteDisplays", null),
    ];

    public static async Task InstallAsync(ClientDataContext context, CancellationToken cancellationToken = default)
    {
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        foreach (var (table, parentColumn) in SyncedTables)
        {
            await InstallTriggerAsync(context, TriggerSql(table, parentColumn, "i", "INSERT", "NEW"), table, "i", cancellationToken);
            await InstallTriggerAsync(context, TriggerSql(table, parentColumn, "u", "UPDATE", "NEW"), table, "u", cancellationToken);
            await InstallTriggerAsync(context, TriggerSql(table, parentColumn, "d", "DELETE", "OLD"), table, "d", cancellationToken);
        }

        // CCLI entries are an append-only upstream queue: only inserts matter, and they are
        // journaled even while 'applying' is set because the server never sends CCLI rows down.
        await InstallTriggerAsync(context,
            $"""
             CREATE TRIGGER trg_CcliReportEntries_i AFTER INSERT ON CcliReportEntries
             BEGIN
                 INSERT INTO {SyncJournalEntry.TableName} (EntityTable, RowId, Op, ParentId, ChangedAt)
                 VALUES ('CcliReportEntries', NEW.Id, 'I', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000);
             END;
             """, "CcliReportEntries", "i", cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task InstallTriggerAsync(
        ClientDataContext context, string createSql, string table, string opSuffix, CancellationToken cancellationToken)
    {
        // Table and suffix come from the static array above, never from input.
#pragma warning disable EF1002
        await context.Database.ExecuteSqlRawAsync($"DROP TRIGGER IF EXISTS trg_{table}_{opSuffix};", cancellationToken);
#pragma warning restore EF1002
        await context.Database.ExecuteSqlRawAsync(createSql, cancellationToken);
    }

    private static string TriggerSql(string table, string? parentColumn, string opSuffix, string operation, string rowRef)
    {
        var parentValue = parentColumn is null ? "NULL" : $"{rowRef}.{parentColumn}";
        return
            $"""
             CREATE TRIGGER trg_{table}_{opSuffix} AFTER {operation} ON {table}
             WHEN COALESCE((SELECT Value FROM {SyncStateEntry.TableName} WHERE Key = '{SyncStateEntry.ApplyingKey}'), '0') <> '1'
             BEGIN
                 INSERT INTO {SyncJournalEntry.TableName} (EntityTable, RowId, Op, ParentId, ChangedAt)
                 VALUES ('{table}', {rowRef}.Id, '{opSuffix.ToUpperInvariant()}', {parentValue}, CAST(strftime('%s','now') AS INTEGER) * 1000);
             END;
             """;
    }
}
