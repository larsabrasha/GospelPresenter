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
/// What the sync engine exposes to the UI. Only the MAUI host registers an implementation; the
/// web app has no sync, so shared components resolve this optionally and render nothing without it.
/// </summary>
public interface ISyncStatusSource
{
    SyncStatus Status { get; }
    DateTimeOffset? LastSyncAt { get; }

    /// <summary>Local changes not yet acknowledged by the server (distinct rows).</summary>
    int PendingChanges { get; }

    /// <summary>Raised whenever Status, LastSyncAt or PendingChanges changed.</summary>
    event Action? Changed;

    /// <summary>A push unit the server resolved against the client — surfaced as a toast.</summary>
    event Action<SyncPushResult>? ConflictReported;

    Task SyncNowAsync();
}
