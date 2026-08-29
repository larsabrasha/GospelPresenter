using GospelPresenter.Shared.Sync;

namespace GospelPresenter.Shared.Services;

public enum SyncStatus
{
    /// <summary>Everything synced (as far as the device knows).</summary>
    Idle,
    Syncing,
    /// <summary>No connection or not signed in; local changes queue up.</summary>
    Offline,
    /// <summary>The server rejected the device token; the user must sign in again.</summary>
    AuthRequired,
    Error,
}

/// <summary>
/// What the sync engine exposes to the UI. Only the hosts that sync — the desktop app and MAUI —
/// register an implementation; the web app talks to the database directly and has no sync at all,
/// so shared components resolve this optionally and do nothing without it.
/// </summary>
public interface ISyncStatusSource
{
    SyncStatus Status { get; }
    DateTimeOffset? LastSyncAt { get; }

    /// <summary>Local changes not yet acknowledged by the server (distinct rows).</summary>
    int PendingChanges { get; }

    /// <summary>Raised whenever Status, LastSyncAt or PendingChanges changed.</summary>
    event Action? Changed;

    /// <summary>
    /// Raised when a pull actually wrote rows to the local database, after the shared caches have
    /// been reloaded — the moment an open view is showing something that is no longer true.
    ///
    /// Deliberately separate from <see cref="Changed"/>, which fires on every status transition and
    /// therefore several times a minute while nothing whatsoever has changed. A view that reloaded
    /// on that would re-query the database on a timer. This one is quiet: no incoming rows, no
    /// event.
    /// </summary>
    event Action? RemoteChangesApplied;

    /// <summary>A push unit the server resolved against the client — surfaced as a toast.</summary>
    event Action<SyncPushResult>? ConflictReported;

    Task SyncNowAsync();
}
