namespace GospelPresenter.Shared.Services;

public enum UpdateState
{
    /// <summary>Nothing to do: either no update exists, or none has been looked for yet.</summary>
    Idle,
    Checking,
    Downloading,

    /// <summary>
    /// A new version is downloaded and staged. It is applied at the next start on its own; the
    /// restart button only saves the user from waiting for one.
    /// </summary>
    ReadyToApply,

    /// <summary>The last attempt failed. Not shown to the user — it is retried on the next check.</summary>
    Failed,
}

/// <summary>
/// Self-updating, for installations that came from our own download rather than a store. Only the
/// MAUI host registers an implementation; the web app is updated by deploying it, so shared
/// components resolve this optionally and render nothing without it — the same shape as
/// <see cref="ISyncStatusSource"/> and <see cref="ILiveWindowLauncher"/>.
///
/// The behaviour this seam exists to express (adr/0002-app-distribution-and-updates.md (16)–(18)):
/// check periodically, download silently, apply at the next start. Nothing here ever restarts the
/// app on its own, and <see cref="ApplyAndRestartAsync"/> must not be called while
/// <see cref="State.SharedAppState.HasActivePresentation"/> is true — an app that restarts itself at
/// 10:55 on a Sunday has ended the service.
/// </summary>
public interface IAppUpdater
{
    UpdateState State { get; }

    /// <summary>The staged version, once <see cref="State"/> is <see cref="UpdateState.ReadyToApply"/>.</summary>
    string? ReadyVersion { get; }

    /// <summary>Raised whenever <see cref="State"/> or <see cref="ReadyVersion"/> changed.</summary>
    event Action? Changed;

    /// <summary>
    /// Looks for a newer version and downloads it if there is one. Safe to call at any time,
    /// including while presenting — it only writes to the staging directory.
    /// </summary>
    Task CheckAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies the staged update and restarts the app immediately. The caller owns the timing, and
    /// the only caller is a button the user pressed while nothing was live.
    /// </summary>
    Task ApplyAndRestartAsync();
}
