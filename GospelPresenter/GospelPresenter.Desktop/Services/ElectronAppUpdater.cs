using ElectronNET.API;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// <see cref="IAppUpdater"/> on top of electron-updater, which Electron.NET already ships and which
/// reads the feed baked into the app at package time (Properties/electron-builder.json).
///
/// The behaviour asked for in adr/0002-app-distribution-and-updates.md (16)–(18) falls out of two
/// settings rather than any logic here: AutoDownload makes the download silent, and
/// AutoInstallOnAppQuit makes it apply at the next start whether or not anyone presses the button.
/// What is left is turning electron-updater's events into the four states the indicator renders.
///
/// Nothing in here restarts the app. <see cref="ApplyAndRestartAsync"/> is called by one button,
/// which the component hides while anything is being presented — see (17), and
/// UpdateAvailableIndicator, where that rule lives.
/// </summary>
public class ElectronAppUpdater(ILogger<ElectronAppUpdater> logger) : IAppUpdater, IDisposable
{
    /// <summary>
    /// How often to look. The machine this is for is switched on all week, so checking only at
    /// startup would mean never — but a church computer is also idle for six days, so there is
    /// nothing to gain from looking often.
    /// </summary>
    public TimeSpan CheckInterval { get; init; } = TimeSpan.FromHours(6);

    /// <summary>
    /// Long enough that the first check does not compete with startup — the database, the first
    /// sync and the media catch-up all want the network before an update does.
    /// </summary>
    public TimeSpan FirstCheckDelay { get; init; } = TimeSpan.FromMinutes(2);

    private CancellationTokenSource? loopCts;
    private bool subscribed;

    public UpdateState State { get; private set; } = UpdateState.Idle;
    public string? ReadyVersion { get; private set; }

    public event Action? Changed;

    /// <summary>
    /// Subscribes to electron-updater and starts the periodic check. Called once Electron is ready,
    /// since none of it exists before then.
    /// </summary>
    public Task InitialiseAsync()
    {
        if (subscribed)
            return Task.CompletedTask;

        Electron.AutoUpdater.AutoDownload = true;
        Electron.AutoUpdater.AutoInstallOnAppQuit = true;

        Electron.AutoUpdater.OnCheckingForUpdate += OnCheckingForUpdate;
        Electron.AutoUpdater.OnUpdateAvailable += OnUpdateAvailable;
        Electron.AutoUpdater.OnUpdateNotAvailable += OnUpdateNotAvailable;
        Electron.AutoUpdater.OnUpdateDownloaded += OnUpdateDownloaded;
        Electron.AutoUpdater.OnError += OnUpdaterError;
        subscribed = true;

        loopCts = new CancellationTokenSource();
        _ = RunLoopAsync(loopCts.Token);

        return Task.CompletedTask;
    }

    /// <summary>
    /// How long to wait for Electron to answer a check. The call crosses the socket bridge to the
    /// Electron process, and a reply that never arrives would otherwise leave the loop below
    /// awaiting for the life of the app — one lost message would silently end updating altogether,
    /// with nothing to see. No such loss has been observed; the budget bounds it rather than fixes
    /// it, and is generous for that reason.
    /// </summary>
    public TimeSpan CheckTimeout { get; init; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// The cancellation token is honoured before the call and not during it: electron-updater owns
    /// the download once it has started, and there is no reason to interrupt one — it writes only
    /// to the staging directory and is discarded if the app closes first.
    /// </summary>
    public async Task CheckAsync(CancellationToken cancellationToken = default)
    {
        // Nothing to look for while a check or a download is in flight, and nothing to gain once a
        // version is staged: the same version would come back, and OnCheckingForUpdate would move
        // the state off ReadyToApply — taking the restart button off screen with it.
        if (State is UpdateState.Checking or UpdateState.Downloading or UpdateState.ReadyToApply)
            return;

        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            budget.CancelAfter(CheckTimeout);

            // WaitAsync abandons the call rather than cancelling it — there is nothing to cancel on
            // the far side. Abandoning is the point: the loop gets its thread back and tries again
            // at the next tick.
            await Electron.AutoUpdater.CheckForUpdatesAsync().WaitAsync(budget.Token);
        }
        catch (Exception ex)
        {
            // Failed is never shown to anyone; the next tick tries again. Note that a development
            // run does not land here: electron-updater declines an unpackaged app by logging "Skip
            // checkForUpdates" and resolving normally, so the state simply stays Idle. Measured, not
            // assumed — six consecutive checks, no exception, no state change.
            logger.LogDebug(ex, "Update check failed");
            SetState(UpdateState.Failed);
        }
    }

    public Task ApplyAndRestartAsync()
    {
        if (State is not UpdateState.ReadyToApply)
            return Task.CompletedTask;

        logger.LogInformation("Applying update {Version} and restarting", ReadyVersion);

        // Silent, because the user already said yes by pressing the button and a Windows installer
        // window would be a second question. Force-run-after, because a restart button that leaves
        // the app closed has not restarted anything.
        Electron.AutoUpdater.QuitAndInstall(isSilent: true, isForceRunAfter: true);
        return Task.CompletedTask;
    }

    private async Task RunLoopAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(FirstCheckDelay, ct);

            while (!ct.IsCancellationRequested)
            {
                await CheckAsync(ct);
                await Task.Delay(CheckInterval, ct);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "The update check loop stopped");
        }
    }

    private void OnCheckingForUpdate() => SetState(UpdateState.Checking);

    private void OnUpdateAvailable(ElectronNET.API.Entities.UpdateInfo info)
    {
        logger.LogInformation("Update {Version} available, downloading", info.Version);
        SetState(UpdateState.Downloading);
    }

    private void OnUpdateNotAvailable(ElectronNET.API.Entities.UpdateInfo info) =>
        SetState(UpdateState.Idle);

    private void OnUpdateDownloaded(ElectronNET.API.Entities.UpdateInfo info)
    {
        logger.LogInformation("Update {Version} downloaded and staged", info.Version);
        ReadyVersion = info.Version;
        SetState(UpdateState.ReadyToApply);
    }

    private void OnUpdaterError(string message)
    {
        logger.LogDebug("Update error: {Message}", message);
        SetState(UpdateState.Failed);
    }

    private void SetState(UpdateState state)
    {
        if (State == state)
            return;

        State = state;
        Changed?.Invoke();
    }

    /// <summary>
    /// Releasing the handlers crosses the socket bridge, and by the time this runs the bridge is
    /// normally already gone: closing the window quits Electron, and only then does the host shut
    /// down and dispose its singletons. ElectronNET answers a call made after that with "Cannot
    /// access socket bridge. Runtime is not in 'Ready' state" — which, thrown out of Dispose, went
    /// unhandled and aborted the process on every exit. Because this service is registered last it
    /// is disposed first, so the abort also skipped every other singleton's disposal.
    ///
    /// The unsubscribes are worth doing while Electron is still up and worth nothing once it is
    /// not, since the process is ending either way. Hence best-effort rather than guarded by a
    /// liveness check, which would still race the far side going away mid-call.
    /// </summary>
    public void Dispose()
    {
        loopCts?.Cancel();
        loopCts?.Dispose();
        loopCts = null;

        if (!subscribed)
            return;

        subscribed = false;

        try
        {
            Electron.AutoUpdater.OnCheckingForUpdate -= OnCheckingForUpdate;
            Electron.AutoUpdater.OnUpdateAvailable -= OnUpdateAvailable;
            Electron.AutoUpdater.OnUpdateNotAvailable -= OnUpdateNotAvailable;
            Electron.AutoUpdater.OnUpdateDownloaded -= OnUpdateDownloaded;
            Electron.AutoUpdater.OnError -= OnUpdaterError;
        }
        catch (Exception ex)
        {
            // The message, not the exception: this is the expected path, and a stack trace printed
            // on every single exit makes a clean shutdown look like a crash. The three frames it
            // would carry are always the same ones, and they are named in the summary above.
            logger.LogDebug("Electron had already gone when the updater unsubscribed: {Reason}", ex.Message);
        }
    }
}
