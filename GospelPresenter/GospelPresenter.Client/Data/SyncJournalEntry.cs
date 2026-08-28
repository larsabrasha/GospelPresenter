namespace GospelPresenter.Client.Data;

/// <summary>
/// One local change, recorded by the SQLite triggers <c>SyncTriggerInstaller</c> installs. The
/// triggers — not EF events — are the dirty detector, because the domain services also mutate
/// rows with ExecuteUpdate/ExecuteDelete, which no interceptor sees. The sync engine coalesces
/// journal rows per (TableName, RowId), pushes current row snapshots, and deletes the journal
/// rows it consumed. The table name is fixed because the trigger SQL references it verbatim.
/// </summary>
public class SyncJournalEntry
{
    public const string TableName = "SyncJournal";

    public long Id { get; set; }
    public string EntityTable { get; set; } = "";
    public string RowId { get; set; } = "";

    /// <summary>"I", "U" or "D".</summary>
    public string Op { get; set; } = "";

    /// <summary>
    /// For child tables, the parent foreign key captured by the trigger (a song part's SongId, an
    /// item's PresentationId, a part's PresentationItemId). It lets the push builder resolve every
    /// journal row to its aggregate root even after the row itself was deleted. Null for roots.
    /// </summary>
    public string? ParentId { get; set; }

    public DateTimeOffset ChangedAt { get; set; }
}
