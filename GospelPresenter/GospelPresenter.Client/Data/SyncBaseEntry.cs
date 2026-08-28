namespace GospelPresenter.Client.Data;

/// <summary>
/// The server version a local row is based on: the ModifiedAt the row had when it was last pulled
/// from (or acknowledged by) the server. Push conflict detection compares this base against the
/// server's current value, so it must survive local edits — which overwrite the row's own
/// ModifiedAt — and therefore lives in its own table. Maintained by the sync engine: written when
/// a pull applies a row or a push is acknowledged, removed when the row is deleted on either side.
/// Only aggregate roots and flat-pushed tables carry a base; children ride on their root's.
/// </summary>
public class SyncBaseEntry
{
    public string EntityTable { get; set; } = "";
    public string RowId { get; set; } = "";
    public DateTimeOffset BaseModifiedAt { get; set; }
}
