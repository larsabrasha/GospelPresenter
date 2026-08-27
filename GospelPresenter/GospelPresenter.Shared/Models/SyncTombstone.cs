namespace GospelPresenter.Shared.Models;

/// <summary>
/// Records that a synced row was deleted, so offline clients can learn about deletions they were
/// not connected to see. Rows are written in the same transaction as the delete — automatically by
/// <c>PresentationContext.SaveChanges</c> for tracked deletes, explicitly by the services for
/// <c>ExecuteDeleteAsync</c> paths. Tombstones older than the retention window are purged; a client
/// whose watermark predates the purge horizon must do a full resync instead.
///
/// Applying a tombstone on a client also cascades to children by foreign key (deleting a
/// presentation deletes its items and parts) and nulls dangling <c>SET NULL</c> references
/// (<c>DbSongPart.LabelId</c>, <c>Presentation.ThemeId</c>), mirroring what the server database
/// did without producing tombstones of its own.
/// </summary>
public class SyncTombstone
{
    /// <summary>
    /// How long tombstones are kept before the purge job removes them. The pull endpoint answers
    /// clients whose watermark is older than this (minus a safety margin) with requiresFullResync.
    /// </summary>
    public static readonly TimeSpan Retention = TimeSpan.FromDays(90);

    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>CLR type name of the deleted entity, e.g. <c>nameof(DbSong)</c>.</summary>
    public string EntityType { get; set; } = "";

    public string EntityId { get; set; } = "";

    /// <summary>Set for organisation-scoped rows; null for user-scoped rows like user settings.</summary>
    public string? OrganizationId { get; set; }

    /// <summary>Set for user-scoped rows; null otherwise.</summary>
    public string? UserId { get; set; }

    public DateTimeOffset DeletedAt { get; set; }
}
