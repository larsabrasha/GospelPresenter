namespace GospelPresenter.Shared.Models;

/// <summary>
/// Entities that participate in offline sync. <see cref="ModifiedAt"/> is the sync watermark,
/// stamped by <c>PresentationContext.SaveChanges</c> on every insert and update. It is separate
/// from user-visible fields like <c>Presentation.UpdatedAt</c>: those carry UI semantics ("last
/// edited by a person"), while this one must move on every row change, whatever the reason.
/// Mutations made with <c>ExecuteUpdateAsync</c> bypass the change tracker and must set it
/// explicitly with <c>SetProperty</c>.
/// </summary>
public interface ISyncTracked
{
    DateTimeOffset ModifiedAt { get; set; }
}
