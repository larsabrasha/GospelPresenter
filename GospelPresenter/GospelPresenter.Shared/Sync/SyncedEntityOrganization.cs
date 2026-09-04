using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.Sync;

/// <summary>
/// Which organisation a synced row belongs to, for addressing a change announcement.
///
/// Child rows answer null, and do not need to answer anything else: the convention this codebase
/// already enforces is that changing a child also bumps its aggregate root's <c>ModifiedAt</c>
/// (<c>PresentationService.BumpPresentationAsync</c>, <c>SongService.TouchSong</c>), so a root that
/// does carry the organisation is part of the same save. Null therefore means "could not be
/// derived", which the notifier turns into an announcement to every organisation — wasteful, rare,
/// and never wrong. That is deliberately the failure mode, rather than a lookup per changed row in
/// the middle of a write.
///
/// This is not the same question <c>PresentationContext.ApplySyncTrackingAsync</c> answers for
/// tombstones. That one must be exact, because a tombstone a client never receives is a deletion
/// that never happens, and it pays for a query per deleted child to get there.
/// </summary>
public static class SyncedEntityOrganization
{
    public static string? For(object entity) => entity switch
    {
        Presentation p => p.OrganizationId,
        DbSong s => s.OrganizationId,
        DbSongPartLabel l => l.OrganizationId,
        OverlaySlide o => o.OrganizationId,
        OrganizationImage i => i.OrganizationId,
        OrganizationAudio a => a.OrganizationId,
        OrganizationSetting os => os.OrganizationId,
        DbBible b => b.OrganizationId,
        RemoteDisplay d => d.OrganizationId,

        // Null for the built-in themes, which every organisation can use — so a change to one is
        // everyone's business, and the null fallback is the right answer rather than a gap.
        Theme t => t.OrganizationId,

        // Written by the same save that deletes a synced row, and already carries the organisation
        // the context resolved exactly. This is how deletes are announced: the deleted entity itself
        // may be a child that answers null, but its tombstone does not.
        SyncTombstone ts => ts.OrganizationId,

        _ => null,
    };
}
