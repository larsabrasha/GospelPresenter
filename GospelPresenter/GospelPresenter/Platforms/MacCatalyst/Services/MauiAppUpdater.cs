using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging;
using Velopack;
using Velopack.Sources;

namespace GospelPresenter.Services;

/// <summary>
/// The Velopack side of <see cref="IAppUpdater"/>: check periodically, download silently, apply at
/// the next start. See adr/0002-app-distribution-and-updates.md (16)–(19).
///
/// Nothing here ever restarts the app on its own. A downloaded update sits staged until either the
/// user presses the restart button — which <see cref="UpdateAvailableIndicator"/> only offers while
/// nothing is being presented — or the app is next started for any reason, at which point Velopack
/// applies it before <c>Main</c> gets going.
///
/// Registered only when the build actually has a feed. In a Test or Local build
/// <see cref="Configuration.Settings.UpdateFeedUrl"/> is empty, this is never constructed, and the
/// shared component resolves nothing and renders nothing — the same absence as on the web.
/// </summary>
public class MauiAppUpdater : IAppUpdater, IDisposable
{
    private readonly UpdateManager manager;
    private readonly ILogger<MauiAppUpdater> logger;
    private readonly PeriodicTimer timer;
    private CancellationTokenSource? loop;
    private UpdateInfo? staged;

    /// <summary>
    /// Six hours. The machine this matters for is a church computer left switched on all week, so
    /// the app may go many days without a restart to check at — but an update is never urgent
    /// either, since applying it waits for a restart regardless.
    /// </summary>
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(6);

    public MauiAppUpdater(string feedUrl, ILogger<MauiAppUpdater> logger)
    {
        this.logger = logger;
        // prerelease: true because the GitHub prerelease flag is not what separates beta from
        // stable here — the Velopack channel is. A beta install reads releases.beta.json and a
        // stable install reads releases.stable.json, from the same set of GitHub releases; the
        // prerelease flag only decides which one GitHub badges as "Latest" on the web. Filtering on
        // it as well would hide every beta from the betas.
        manager = new UpdateManager(new GithubSource(feedUrl, accessToken: null, prerelease: true));
        timer = new PeriodicTimer(CheckInterval);
    }

    public UpdateState State { get; private set; } = UpdateState.Idle;

    public string? ReadyVersion { get; private set; }

    public event Action? Changed;

    /// <summary>Starts the background loop. Called once at startup, like the CCLI listener.</summary>
    public void Start()
    {
        if (loop is not null)
            return;

        loop = new CancellationTokenSource();
        _ = RunLoopAsync(loop.Token);
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        // Once at startup, then on the interval. The first check is the one most likely to find
        // something, since the app was last running on an older version.
        await CheckAsync(cancellationToken);

        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
                await CheckAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Shutting down.
        }
    }

    public async Task CheckAsync(CancellationToken cancellationToken = default)
    {
        // An update already waiting is not looked past: applying it is what clears this, and
        // checking again would only replace one staged version with another for no benefit.
        if (State is UpdateState.Checking or UpdateState.Downloading or UpdateState.ReadyToApply)
            return;

        // Velopack does nothing useful for a build that was not installed by it — a developer's
        // dotnet build, or a copy dragged out of a zip. Checking anyway would log a failure every
        // six hours for the rest of the session.
        if (!manager.IsInstalled)
        {
            logger.LogDebug("Not a Velopack installation; skipping the update check");
            return;
        }

        try
        {
            SetState(UpdateState.Checking);
            var update = await manager.CheckForUpdatesAsync().WaitAsync(cancellationToken);
            if (update is null)
            {
                SetState(UpdateState.Idle);
                return;
            }

            logger.LogInformation("Downloading update {Version}", update.TargetFullRelease.Version);
            SetState(UpdateState.Downloading);
            await manager.DownloadUpdatesAsync(update).WaitAsync(cancellationToken);

            staged = update;
            ReadyVersion = update.TargetFullRelease.Version.ToString();
            SetState(UpdateState.ReadyToApply);
            logger.LogInformation("Update {Version} is staged and applies on the next start", ReadyVersion);
        }
        catch (OperationCanceledException)
        {
            SetState(UpdateState.Idle);
        }
        catch (Exception e)
        {
            // Offline, a half-written download, a feed that 404s — all recoverable, and all
            // retried on the next tick. The user is told nothing: there is nothing for them to do.
            logger.LogWarning(e, "The update check failed");
            SetState(UpdateState.Failed);
        }
    }

    public async Task ApplyAndRestartAsync()
    {
        if (staged is null)
            return;

        logger.LogInformation("Applying update {Version} and restarting", ReadyVersion);
        await Task.Run(() => manager.ApplyUpdatesAndRestart(staged));
    }

    private void SetState(UpdateState state)
    {
        if (State == state)
            return;

        State = state;
        Changed?.Invoke();
    }

    public void Dispose()
    {
        loop?.Cancel();
        loop?.Dispose();
        timer.Dispose();
    }
}
