using GospelPresenter.Shared.Services;

namespace GospelPresenter.Shared.Sync;

public interface ISyncService
{
    /// <summary>
    /// Returns every synced row in the caller's organisation changed since the request's
    /// watermark, paged, followed by tombstones. See <see cref="SyncPullResponse"/> for the contract.
    /// </summary>
    Task<SyncPullResponse> PullAsync(string organizationId, SyncPullRequest request, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies offline changes from a client. Aggregates whose BaseModifiedAt matches the server
    /// row apply as-is; the rest run the agreed conflict policy — the server always wins, a losing
    /// presentation is preserved as a copy, a losing song goes into its version history, and
    /// everything else is simply rejected with the server's row left standing.
    /// </summary>
    Task<SyncPushResponse> PushAsync(string organizationId, SyncPushRequest request, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// The verses of one Bible translation, as the raw JSON array stored in the database. Bibles
    /// are excluded from the pull (a translation is megabytes); the client downloads one when the
    /// user pins it for offline, and again when its pull metadata shows a newer ModifiedAt.
    /// Null when the translation does not exist in the organisation.
    /// </summary>
    Task<string?> GetBibleVersesJsonAsync(string organizationId, string bibleId, CallerContext caller, CancellationToken cancellationToken = default);
}
