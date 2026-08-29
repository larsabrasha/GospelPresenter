namespace GospelPresenter.Client.Data;

/// <summary>
/// The server version a local row is based on: the Version the row carried when it was last pulled
/// from (or acknowledged by) the server. Push conflict detection compares this base against the
/// server's current value, so it must survive local edits — which overwrite the row's own copy of
/// the version — and therefore lives in its own table. Maintained by the sync engine: written when
/// a pull applies a row or a push is acknowledged, removed when the row is deleted on either side.
/// Only aggregate roots and flat-pushed tables carry a base; children ride on their root's.
///
/// Opaque here by design. The client never reads meaning out of this number, never compares two of
/// them, and never invents one — it stores what the server sent and hands it back. That is what
/// makes the comparison reliable, and it is the lesson of the timestamp this replaced: a value the
/// client had to store in its own representation was a value that could come back subtly different.
/// </summary>
public class SyncBaseEntry
{
    public string EntityTable { get; set; } = "";
    public string RowId { get; set; } = "";
    public long BaseVersion { get; set; }
}
