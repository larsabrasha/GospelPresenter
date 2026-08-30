using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Decides WHEN to sync; the engine decides what. Triggers: app start, connectivity returning,
/// a manual "sync now", local edits, and simply time passing — see <see cref="IdlePullInterval"/>.
///
/// Local edits are detected by polling the journal's max rowid, which catches every write path
/// including ExecuteUpdate/ExecuteDelete. An edit only syncs once the journal has been quiet for one
/// poll interval, so a burst of editing coalesces into one push.
///
/// Also the UI's <see cref="ISyncStatusSource"/>. Failures never throw out of the loop: they set
/// the status (Offline, AuthRequired, Error) and the next trigger tries again.
/// </summary>
public class SyncScheduler(
    ClientSyncService engine,
    IDbContextFactory<ClientDataContext> contextFactory,
    IConnectivityMonitor connectivity,
    DeviceAuthService auth,
    ILogger<SyncScheduler> logger,
    Media.IMediaSynchronizer? mediaSynchronizer = null,
    LocalWriteSignal? localWrites = null) : ISyncStatusSource, IDisposable
{
    /// <summary>
    /// The backstop, for anything the write signal did not carry. Overridable for tests.
    ///
    /// Nothing here reaches the server on its own: a tick reads the local journal, and only a tick
    /// that finds something to send — or one whose idle interval has elapsed — makes a request. So
    /// this interval paces local reads, not network traffic.
    /// </summary>
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromSeconds(10);

    /// <summary>
    /// How long a burst of local writes is gathered before syncing. Long enough that saving a
    /// presentation with a dozen rows is one sync, short enough that nobody waits.
    ///
    /// A maximum wait, not a restarting debounce: the signal is raised by every database command,
    /// reads included, so a page that queries steadily would keep resetting a restarting one and a
    /// write could sit unsent behind a stream of reads. The first signal of a burst schedules the
    /// run and the rest are free — which also keeps the cost per signal to an interlocked compare,
    /// and there are thousands of them while a pull is being applied.
    ///
    /// Overridable for tests.
    /// </summary>
    public TimeSpan WriteSignalDelay { get; init; } = TimeSpan.FromMilliseconds(500);

    /// <summary>
    /// How long the app may go without asking the server whether anything changed. The journal poll
    /// above only ever notices OUR edits, so without this a device with nothing to push never syncs
    /// again after the one at startup: someone adds a song on the web, and the app sits there
    /// showing yesterday's library until it is restarted.
    ///
    /// Longer than the journal poll on purpose. A push has a local edit waiting behind it and should
    /// leave promptly; an idle pull is a question whose answer is almost always "nothing", so it is
    /// asked at a rate that keeps a second person's edits arriving while someone is preparing a
    /// service, without making a church laptop chat with the server six times a minute all evening.
    ///
    /// Overridable for tests.
    /// </summary>
    public TimeSpan IdlePullInterval { get; init; } = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim syncGate = new(1, 1);
    private CancellationTokenSource? loopCts;

    private Timer? writeSignalTimer;
    private int writeSignalPending;

    /// <summary>
    /// Greater than zero while the scheduler is itself using the database, so that its own reads and
    /// writes do not come back as write signals.
    ///
    /// Without this the signal feeds itself: a sync reads the journal, the read raises the signal,
    /// and the signal answers with another sync. Measured on a real device before this existed —
    /// 59 pulls in 60 seconds on a machine nobody was touching, for ever.
    ///
    /// A genuine edit made during a sync is dropped here, which is the same trade the engine already
    /// makes for rows journaled while a push is in flight: the run that follows picks it up, and the
    /// poll is behind that.
    /// </summary>
    private int ownDatabaseWork;

    /// <summary>
    /// When a sync last ran, successful or not — unlike <see cref="LastSyncAt"/>, which only records
    /// the ones that worked. The idle pull is paced off this so that a server which is down, or a
    /// token which has been rejected, is retried on the same interval rather than on every tick.
    /// </summary>
    private DateTimeOffset lastSyncAttemptAt = DateTimeOffset.MinValue;

    public SyncStatus Status { get; private set; } = SyncStatus.Offline;
    public DateTimeOffset? LastSyncAt { get; private set; }
    public int PendingChanges { get; private set; }

    public event Action? Changed;
    public event Action? RemoteChangesApplied;
    public event Action<SyncPushResult>? ConflictReported;

    public void Start()
    {
        if (loopCts is not null)
            return;
        loopCts = new CancellationTokenSource();
        connectivity.Changed += OnConnectivityChanged;
        auth.Changed += OnAuthChanged;

        if (localWrites is not null)
        {
            // One timer for the lifetime of the scheduler, only ever rescheduled. A timer per
            // signal would allocate thousands of them while a pull is applied.
            writeSignalTimer = new Timer(_ => OnWriteSignalElapsed(), null,
                Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
            localWrites.Written += OnLocalWrite;
        }

        _ = RunLoopAsync(loopCts.Token);
    }

    /// <summary>
    /// Raised from inside a database command, so this schedules and returns — it must never block
    /// the write that produced it.
    /// </summary>
    private void OnLocalWrite()
    {
        if (Volatile.Read(ref ownDatabaseWork) > 0)
            return;
        ScheduleWriteSync();
    }

    private void ScheduleWriteSync()
    {
        if (Interlocked.Exchange(ref writeSignalPending, 1) == 0)
            writeSignalTimer?.Change(WriteSignalDelay, Timeout.InfiniteTimeSpan);
    }

    private void OnWriteSignalElapsed()
    {
        Interlocked.Exchange(ref writeSignalPending, 0);
        _ = HandleWriteSignalAsync();
    }

    private async Task HandleWriteSignalAsync()
    {
        var ct = loopCts?.Token ?? CancellationToken.None;
        try
        {
            // Nothing of this device's own to send means nothing to do. The signal is about getting
            // local work up; asking the server what IS new is the idle pull's job, and answering
            // every signal with a pull is what turned an idle machine into a stream of requests.
            if (await ReadPendingCountAsync(ct) == 0)
                return;

            // Straight to the sync rather than through a tick: the wait already was the coalescing,
            // and a tick would only make it wait again.
            await SyncAsync(ct);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception e)
        {
            logger.LogError(e, "Could not act on a local write signal");
        }
    }

    public Task SyncNowAsync() => SyncAsync(loopCts?.Token ?? CancellationToken.None);

    private async Task RunLoopAsync(CancellationToken ct)
    {
        // App start: catch up immediately.
        await SyncAsync(ct);

        try
        {
            using var timer = new PeriodicTimer(PollInterval);
            while (await timer.WaitForNextTickAsync(ct))
                await TickAsync(ct);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        try
        {
            var pending = await ReadPendingCountAsync(ct);
            if (pending != PendingChanges)
            {
                PendingChanges = pending;
                RaiseChanged();
            }

            // No waiting a further tick to coalesce: WriteSignalDelay does that, and doing it here
            // as well would only make the backstop twice as slow as it needs to be.
            if (pending > 0)
            {
                await SyncAsync(ct);
            }
            else if (DateTimeOffset.UtcNow - lastSyncAttemptAt >= IdlePullInterval)
            {
                // Nothing of ours to send, so this is purely "has anything happened at your end?".
                await SyncAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception e)
        {
            logger.LogError(e, "The sync poll tick failed");
        }
    }

    private void OnConnectivityChanged()
    {
        if (connectivity.IsOnline)
            _ = SyncNowAsync();
        else
            SetStatus(SyncStatus.Offline);
    }

    private void OnAuthChanged()
    {
        if (auth.IsSignedIn)
            _ = SyncNowAsync();
    }

    private async Task SyncAsync(CancellationToken ct)
    {
        if (!auth.IsSignedIn || !connectivity.IsOnline)
        {
            SetStatus(SyncStatus.Offline);
            return;
        }

        if (!await syncGate.WaitAsync(0, ct))
            return;

        lastSyncAttemptAt = DateTimeOffset.UtcNow;
        SetStatus(SyncStatus.Syncing);
        Interlocked.Increment(ref ownDatabaseWork);
        try
        {
            var summary = await engine.SyncAsync(ct);

            // Before the media sync, not after: the lists a person is looking at are metadata, and
            // waiting for blobs would leave them stale for as long as the downloads take. Missing
            // images resolve themselves — LocalObjectStorageService fetches on demand.
            if (summary.PulledRows > 0)
                RemoteChangesApplied?.Invoke();

            if (mediaSynchronizer is not null)
                await mediaSynchronizer.SyncAsync(ct);
            LastSyncAt = DateTimeOffset.UtcNow;
            foreach (var conflict in summary.Conflicts)
                ConflictReported?.Invoke(conflict);
            SetStatus(SyncStatus.Idle);
        }
        catch (SyncAuthorizationException)
        {
            logger.LogWarning("The device token was rejected; the user must sign in again");
            SetStatus(SyncStatus.AuthRequired);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception e) when (e is HttpRequestException or IOException)
        {
            logger.LogInformation("Sync could not reach the server: {Message}", e.Message);
            SetStatus(SyncStatus.Offline);
        }
        catch (Exception e)
        {
            logger.LogError(e, "Sync failed");
            SetStatus(SyncStatus.Error);
        }
        finally
        {
            Interlocked.Decrement(ref ownDatabaseWork);
            syncGate.Release();
            try
            {
                PendingChanges = await ReadPendingCountAsync(CancellationToken.None);
                RaiseChanged();

                // Rows journaled while the push was in flight are deliberately left for the next
                // cycle. Without this that cycle is the poll, so someone who saves twice in quick
                // succession gets one fast change and one slow one. Scheduled directly rather than
                // through OnLocalWrite, which is deaf while the scheduler is the one writing — and
                // this cannot spin, because reaching Idle means the server was reached and the
                // journal consumed, so anything still pending is new work.
                if (Status == SyncStatus.Idle && PendingChanges > 0)
                    ScheduleWriteSync();
            }
            catch (Exception e)
            {
                logger.LogError(e, "Failed to refresh the pending-changes count after a sync");
            }
        }
    }

    /// <summary>
    /// How many distinct rows are waiting to be pushed. The answer to every write signal, so it has
    /// to be cheap: measured at six microseconds against a real device database.
    /// </summary>
    private async Task<int> ReadPendingCountAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref ownDatabaseWork);
        try
        {
            await using var db = await contextFactory.CreateDbContextAsync(ct);
            return await db.SyncJournal.AsNoTracking()
                .Select(j => new { j.EntityTable, j.RowId })
                .Distinct()
                .CountAsync(ct);
        }
        finally
        {
            Interlocked.Decrement(ref ownDatabaseWork);
        }
    }

    private void SetStatus(SyncStatus status)
    {
        if (Status == status)
            return;
        Status = status;
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke();

    private bool disposed;

    /// <summary>
    /// Idempotent, for the same reason <see cref="ClientSyncService"/>'s caller is: the desktop host
    /// registers this under its own type and again as <see cref="ISyncStatusSource"/> through a
    /// factory that hands back the same object, and the container tracks what a factory returns for
    /// disposal without checking whether it is already tracking it. The second call reached a
    /// cancellation source the first had disposed, and closing the app ended in an unhandled
    /// exception rather than a clean stop.
    /// </summary>
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;

        connectivity.Changed -= OnConnectivityChanged;
        auth.Changed -= OnAuthChanged;
        if (localWrites is not null)
            localWrites.Written -= OnLocalWrite;
        writeSignalTimer?.Dispose();
        loopCts?.Cancel();
        loopCts?.Dispose();
    }
}
