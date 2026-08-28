using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Decides WHEN to sync; the engine decides what. Triggers: app start, connectivity returning,
/// a manual "sync now", and local edits — detected by polling the journal's max rowid, which
/// catches every write path including ExecuteUpdate/ExecuteDelete. An edit only syncs once the
/// journal has been quiet for one poll interval, so a burst of editing coalesces into one push.
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
    Media.IMediaSynchronizer? mediaSynchronizer = null) : ISyncStatusSource, IDisposable
{
    /// <summary>Overridable for tests.</summary>
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromSeconds(10);

    private readonly SemaphoreSlim syncGate = new(1, 1);
    private CancellationTokenSource? loopCts;
    private long lastSeenJournalId = -1;

    public SyncStatus Status { get; private set; } = SyncStatus.Offline;
    public DateTimeOffset? LastSyncAt { get; private set; }
    public int PendingChanges { get; private set; }

    public event Action? Changed;
    public event Action<SyncPushResult>? ConflictReported;

    public void Start()
    {
        if (loopCts is not null)
            return;
        loopCts = new CancellationTokenSource();
        connectivity.Changed += OnConnectivityChanged;
        auth.Changed += OnAuthChanged;
        _ = RunLoopAsync(loopCts.Token);
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
            var (pending, maxJournalId) = await ReadJournalStateAsync(ct);
            if (pending != PendingChanges)
            {
                PendingChanges = pending;
                RaiseChanged();
            }

            if (maxJournalId > lastSeenJournalId)
            {
                // Fresh edits: wait one quiet interval before pushing, so bursts coalesce.
                lastSeenJournalId = maxJournalId;
                return;
            }

            if (pending > 0)
                await SyncAsync(ct);
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

        SetStatus(SyncStatus.Syncing);
        try
        {
            var summary = await engine.SyncAsync(ct);
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
            syncGate.Release();
            try
            {
                var (pending, maxId) = await ReadJournalStateAsync(CancellationToken.None);
                PendingChanges = pending;
                lastSeenJournalId = maxId;
                RaiseChanged();
            }
            catch (Exception e)
            {
                logger.LogError(e, "Failed to refresh the pending-changes count after a sync");
            }
        }
    }

    private async Task<(int Pending, long MaxJournalId)> ReadJournalStateAsync(CancellationToken ct)
    {
        await using var db = await contextFactory.CreateDbContextAsync(ct);
        var pending = await db.SyncJournal.AsNoTracking()
            .Select(j => new { j.EntityTable, j.RowId })
            .Distinct()
            .CountAsync(ct);
        var maxId = await db.SyncJournal.AsNoTracking()
            .Select(j => (long?)j.Id)
            .MaxAsync(ct) ?? 0;
        return (pending, maxId);
    }

    private void SetStatus(SyncStatus status)
    {
        if (Status == status)
            return;
        Status = status;
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke();

    public void Dispose()
    {
        connectivity.Changed -= OnConnectivityChanged;
        auth.Changed -= OnAuthChanged;
        loopCts?.Cancel();
        loopCts?.Dispose();
    }
}
