namespace GospelPresenter.Shared.Models;

/// <summary>
/// Entities that participate in offline sync.
///
/// <see cref="ModifiedAt"/> is the sync watermark, stamped by <c>PresentationContext.SaveChanges</c>
/// on every insert and update. It is separate from user-visible fields like
/// <c>Presentation.UpdatedAt</c>: those carry UI semantics ("last edited by a person"), while this
/// one must move on every row change, whatever the reason. Mutations made with
/// <c>ExecuteUpdateAsync</c> bypass the change tracker and must set it explicitly with
/// <c>SetProperty</c>.
///
/// <see cref="Version"/> is what push conflict detection compares, and it exists because
/// <see cref="ModifiedAt"/> is bad at that job. A timestamp answers "what changed since?" — an
/// ordering question, asked with a range, tolerant of a lost digit. Conflict detection asks "is this
/// row still exactly as I last saw it?", which is an equality question, and equality over a
/// wall clock is fragile in two directions: precision that does not survive a round trip produces
/// conflicts that are not real, and a clock that steps backwards produces agreement that is not real.
/// The first was measured here in August 2026 — nine of thirteen presentations on a test device could
/// never match the server and produced an "(offline changes)" copy on every edit.
/// </summary>
public interface ISyncTracked
{
    DateTimeOffset ModifiedAt { get; set; }

    /// <summary>
    /// Bumped by a database trigger on every write, so no call site can forget it — which matters,
    /// because forgetting is exactly what went wrong with the timestamp: SaveChanges truncated it
    /// correctly and eleven <c>ExecuteUpdateAsync</c> sites did not. Triggers fire on those too, and
    /// on raw SQL.
    ///
    /// The client never generates one. It stores the value the server sent and hands it back
    /// untouched, so nothing about how either side represents time can affect the comparison.
    /// </summary>
    long Version { get; set; }
}
