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
/// "The data under an open view has changed underneath it." Separate from
/// <see cref="ISyncStatusSource"/> because both hosts have this and only one of them syncs: on a
/// device it is a pull that wrote rows, on the web it is another user's edit arriving through
/// <c>IOrganizationChangeNotifier</c>. Views resolve this optionally and reload when it fires.
///
/// Splitting it out is what lets the web have live reloads without a sync status indicator: the
/// indicator resolves <see cref="ISyncStatusSource"/>, which the web still does not register,
/// because there is no sync there to report on.
/// </summary>
public interface IRemoteChangeSignal
{
    /// <summary>
    /// Raised when data an open view may be showing has changed — on a device after the shared
    /// caches have been reloaded, so a view that reloads sees the new rows.
    /// </summary>
    event Action? RemoteChangesApplied;
}

/// <summary>
/// What the sync engine exposes to the UI. Only the hosts that sync — the desktop app and MAUI —
/// register an implementation; the web app talks to the database directly and has no sync at all,
/// so shared components resolve this optionally and do nothing without it.
/// </summary>
public interface ISyncStatusSource : IRemoteChangeSignal
{
    SyncStatus Status { get; }
    DateTimeOffset? LastSyncAt { get; }

    /// <summary>Local changes not yet acknowledged by the server (distinct rows).</summary>
    int PendingChanges { get; }

    /// <summary>Raised whenever Status, LastSyncAt or PendingChanges changed.</summary>
    event Action? Changed;

    // RemoteChangesApplied comes from IRemoteChangeSignal. It is deliberately separate from Changed,
    // which fires on every status transition and therefore several times a minute while nothing
    // whatsoever has changed: a view that reloaded on that would re-query the database on a timer.
    // The other one is quiet — no incoming rows, no event.

    /// <summary>A push unit the server resolved against the client — surfaced as a toast.</summary>
    event Action<SyncPushResult>? ConflictReported;

    Task SyncNowAsync();
}
