using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Sync;

/// <summary>What one sync cycle did, for status display and conflict toasts.</summary>
public record SyncRunSummary(int PushedChanges, int PulledRows, IReadOnlyList<SyncPushResult> Conflicts);

/// <summary>The server said 401: the device token was revoked. The user must sign in again.</summary>
public class SyncAuthorizationException() : Exception("The device token was rejected by the server.");

/// <summary>
/// The device's sync engine: push first (the change journal, coalesced per aggregate, becomes the
/// current local state of each touched root), then pull (everything the server accumulated,
/// applied atomically with echo suppression). Push-first means conflicts resolve server-side and
/// the following pull delivers their outcome — the conflict copy, the surviving row, the remap.
///
/// The journal rowid captured before the push is the consumption watermark: rows journaled while
/// the push is in flight survive and go with the next cycle. Any network failure leaves the
/// journal untouched, so nothing is lost by syncing eagerly.
/// </summary>
public class ClientSyncService(
    IDbContextFactory<ClientDataContext> contextFactory,
    HttpClient http,
    ISyncCacheRefresher cacheRefresher,
    DeviceAuthService auth,
    string? deviceName,
    ILogger<ClientSyncService> logger)
{
    public const string HttpClientName = "SyncApi";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<SyncRunSummary> SyncAsync(CancellationToken cancellationToken = default)
    {
        var (pushed, conflicts) = await PushAsync(cancellationToken);
        var pull = await PullAsync(cancellationToken);

        if (pull.SongsChanged)
            await cacheRefresher.RefreshSongsAsync();
        if (pull.BiblesChanged)
            await cacheRefresher.RefreshBiblesAsync();

        return new SyncRunSummary(pushed, pull.AppliedRows, conflicts);
    }

    private async Task<(int Pushed, List<SyncPushResult> Conflicts)> PushAsync(CancellationToken ct)
    {
        await using var db = await contextFactory.CreateDbContextAsync(ct);
        var journal = await db.SyncJournal.AsNoTracking().OrderBy(j => j.Id).ToListAsync(ct);
        if (journal.Count == 0)
            return (0, []);

        var maxJournalId = journal[^1].Id;
        var conflicts = new List<SyncPushResult>();
        var pushed = 0;

        var domainEntries = journal.Where(j => j.EntityTable != "CcliReportEntries").ToList();
        if (domainEntries.Count > 0)
        {
            var request = await SyncPushBuilder.BuildAsync(db, domainEntries, deviceName, ct);
            SyncPushResponse? response = null;
            if (request is not null)
            {
                pushed = request.SongPartLabels.Count + request.Songs.Count + request.OrganizationImages.Count
                         + request.OrganizationAudios.Count + request.OverlaySlides.Count + request.Presentations.Count
                         + request.OrganizationSettings.Count + request.UserSettings.Count + request.Deletes.Count;
                response = await PostAsync<SyncPushRequest, SyncPushResponse>("/api/sync/push", request, ct);
            }

            conflicts = await ApplyPushResponseAsync(db, response, maxJournalId, ct);
            await AdoptServerStateAsync(db, conflicts, ct);
        }

        var ccliEntries = journal.Where(j => j.EntityTable == "CcliReportEntries").ToList();
        if (ccliEntries.Count > 0)
            pushed += await PushCcliAsync(db, ccliEntries, maxJournalId, ct);

        return (pushed, conflicts);
    }

    /// <summary>
    /// Takes the server's version of everything the push lost, so the device stops disagreeing.
    ///
    /// This runs AFTER the booking transaction on purpose: the applier skips rows whose root still
    /// has journal entries, and the booking is what consumes them. Run it before, and the applier
    /// would politely decline to overwrite the very rows that need overwriting.
    ///
    /// Without this the device keeps the version the server rejected, with an empty journal and a
    /// base that can never match again — invisible, unpushable, and good for one fresh conflict per
    /// edit for as long as the row exists. A later pull cannot repair it: the server did not touch
    /// the row it kept, so it stays below the watermark forever.
    /// </summary>
    private async Task AdoptServerStateAsync(
        ClientDataContext db, List<SyncPushResult> conflicts, CancellationToken ct)
    {
        var states = conflicts.Select(c => c.ServerState).OfType<SyncChanges>().ToList();
        if (states.Count == 0)
            return;

        foreach (var state in states)
        {
            // No watermark: this covers particular rows, not a window of server time. Advancing it
            // here would skip whatever else changed server-side in the meantime.
            var applier = new SyncPullApplier(db, auth.CurrentIdentity, logger);
            await applier.ApplyAsync(
                new PullBatch(state, [], ServerWatermark: null, RequiresFullResync: false), ct);
        }

        logger.LogInformation("Adopted the server's version of {Count} rejected aggregate(s)", states.Count);
    }

    /// <summary>
    /// Books the push outcome: acknowledged rows get their new conflict base, remapped rows are
    /// repointed locally, and the consumed journal rows are deleted — atomically, with the trigger
    /// guard up so the local rewrites are not journaled as fresh edits.
    /// </summary>
    private async Task<List<SyncPushResult>> ApplyPushResponseAsync(
        ClientDataContext db, SyncPushResponse? response, long maxJournalId, CancellationToken ct)
    {
        var conflicts = new List<SyncPushResult>();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SyncSql.SetStateAsync(db, SyncStateEntry.ApplyingKey, "1", ct);

        foreach (var result in response?.Results ?? [])
        {
            var table = SyncTables.TableForEntityType(result.EntityType);
            if (table is null)
                continue;

            switch (result.Outcome)
            {
                case SyncPushOutcome.Applied when result.NewVersion is { } newBase:
                    await SyncSql.UpsertBaseAsync(db, table, result.Id, newBase, ct);
                    break;

                case SyncPushOutcome.Applied:
                    // An acknowledged delete: the row is gone on both sides.
                    await SyncSql.RemoveBaseAsync(db, table, result.Id, ct);
                    break;

                case SyncPushOutcome.Remapped when result.NewId is { } newId && newId != result.Id:
                    // The server kept its own equivalent row (same label text or setting key), and
                    // already rewrote the pushed references. Drop the local duplicate — SET NULL
                    // clears any label references for a moment — and let the following pull deliver
                    // the surviving row and the repointed children.
                    if (result.EntityType == nameof(Shared.Models.DbSongPartLabel))
                        await db.Database.ExecuteSqlAsync($"DELETE FROM SongPartLabels WHERE Id = {result.Id}", ct);
                    else if (result.EntityType == nameof(Shared.Models.OrganizationSetting))
                        await db.Database.ExecuteSqlAsync($"DELETE FROM OrganizationSettings WHERE Id = {result.Id}", ct);
                    else if (result.EntityType == nameof(Shared.Models.UserSetting))
                        await db.Database.ExecuteSqlAsync($"DELETE FROM UserSettings WHERE Id = {result.Id}", ct);

                    await SyncSql.RemoveBaseAsync(db, table, result.Id, ct);
                    break;

                case SyncPushOutcome.ServerWins:
                case SyncPushOutcome.Merged:
                    // The base is deliberately not updated here. AdoptServerStateAsync writes it,
                    // from the row it applies, once this transaction has consumed the journal.
                    conflicts.Add(result);
                    break;

                case SyncPushOutcome.Failed:
                    logger.LogWarning("The server rejected a pushed {EntityType} ({Id}): {Warning}",
                        result.EntityType, result.Id, result.Warning);
                    conflicts.Add(result);
                    break;
            }
        }

        // The journal up to the captured rowid is consumed whatever the outcomes were: retrying a
        // rejected unit verbatim can never succeed, and conflict outcomes resolve via the pull.
        await db.Database.ExecuteSqlAsync(
            $"DELETE FROM SyncJournal WHERE Id <= {maxJournalId} AND EntityTable <> 'CcliReportEntries'", ct);

        await SyncSql.SetStateAsync(db, SyncStateEntry.ApplyingKey, "0", ct);
        await transaction.CommitAsync(ct);
        return conflicts;
    }

    /// <summary>
    /// Song displays recorded while presenting offline, pushed to the dedicated idempotent
    /// endpoint (a lost response and a re-push is a no-op on the server).
    /// </summary>
    private async Task<int> PushCcliAsync(
        ClientDataContext db, List<SyncJournalEntry> ccliEntries, long maxJournalId, CancellationToken ct)
    {
        var ids = ccliEntries.Select(e => e.RowId).Distinct().ToList();
        var rows = await db.CcliReportEntries.AsNoTracking()
            .Where(c => ids.Contains(c.Id))
            .ToListAsync(ct);

        var payload = rows
            .Select(r => new CcliSyncEntry(r.SongId, r.SongName, r.CcliNumber, r.PresentationId, r.PresentationName, r.Date))
            .ToList();

        foreach (var chunk in payload.Chunk(SyncDefaults.MaxPullTake))
        {
            using var response = await http.PostAsJsonAsync("/api/sync/ccli-reports", chunk, JsonOptions, ct);
            ThrowIfUnauthorized(response);
            response.EnsureSuccessStatusCode();
        }

        await db.Database.ExecuteSqlAsync(
            $"DELETE FROM SyncJournal WHERE Id <= {maxJournalId} AND EntityTable = 'CcliReportEntries'", ct);
        return payload.Count;
    }

    private async Task<PullApplyResult> PullAsync(CancellationToken ct)
    {
        await using var db = await contextFactory.CreateDbContextAsync(ct);

        var stored = await SyncSql.GetStateAsync(db, SyncStateEntry.WatermarkKey, ct);
        DateTimeOffset? since = stored is null ? null : DateTimeOffset.Parse(stored, null, System.Globalization.DateTimeStyles.RoundtripKind);

        var batch = await FetchAllPagesAsync(since, ct);
        if (batch.RequiresFullResync)
        {
            logger.LogWarning("The server requires a full resync (the watermark predates the tombstone horizon); clearing local synced data");
            await ClearSyncedDataAsync(db, ct);
            batch = await FetchAllPagesAsync(null, ct);
        }

        var applier = new SyncPullApplier(db, auth.CurrentIdentity, logger);
        return await applier.ApplyAsync(batch, ct);
    }

    private async Task<PullBatch> FetchAllPagesAsync(DateTimeOffset? since, CancellationToken ct)
    {
        var changes = new SyncChanges();
        var tombstones = new List<SyncTombstoneDto>();
        string? cursor = null;
        DateTimeOffset watermark = default;

        while (true)
        {
            var page = await PostAsync<SyncPullRequest, SyncPullResponse>(
                "/api/sync/pull", new SyncPullRequest(since, cursor), ct);
            if (page.RequiresFullResync)
                return new PullBatch(changes, tombstones, page.ServerWatermark, RequiresFullResync: true);

            Merge(changes, page.Changes);
            tombstones.AddRange(page.Tombstones);
            watermark = page.ServerWatermark;

            if (!page.HasMore)
                return new PullBatch(changes, tombstones, watermark, RequiresFullResync: false);
            cursor = page.NextCursor;
        }
    }

    private static void Merge(SyncChanges into, SyncChanges page)
    {
        into.SongPartLabels.AddRange(page.SongPartLabels);
        into.Songs.AddRange(page.Songs);
        into.SongParts.AddRange(page.SongParts);
        into.SongArrangements.AddRange(page.SongArrangements);
        into.SongVersions.AddRange(page.SongVersions);
        into.Presentations.AddRange(page.Presentations);
        into.PresentationItems.AddRange(page.PresentationItems);
        into.PresentationItemParts.AddRange(page.PresentationItemParts);
        into.PresentationSlides.AddRange(page.PresentationSlides);
        into.Themes.AddRange(page.Themes);
        into.OverlaySlides.AddRange(page.OverlaySlides);
        into.OrganizationImages.AddRange(page.OrganizationImages);
        into.OrganizationAudios.AddRange(page.OrganizationAudios);
        into.OrganizationSettings.AddRange(page.OrganizationSettings);
        into.UserSettings.AddRange(page.UserSettings);
        into.Bibles.AddRange(page.Bibles);
    }

    /// <summary>
    /// The full-resync wipe: every synced table, the conflict bases, the journal and the watermark.
    /// Runs after the push, so anything pushable was already offered to the server.
    /// </summary>
    private static async Task ClearSyncedDataAsync(ClientDataContext db, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SyncSql.SetStateAsync(db, SyncStateEntry.ApplyingKey, "1", ct);

        // Children before parents; SET NULL references (part labels, presentation themes) resolve
        // because their targets are cleared after the referencing tables.
        string[] tables =
        [
            "PresentationItemParts", "PresentationItems", "PresentationSlides", "Presentations",
            "SongVersions", "SongArrangements", "SongParts", "Songs", "SongPartLabels",
            "OverlaySlides", "OrganizationImages", "OrganizationAudios",
            "OrganizationSettings", "UserSettings", "Bibles", "Themes",
            "SyncBase", "SyncJournal",
        ];
        // Table names come from the static list above, never from input.
#pragma warning disable EF1002
        foreach (var table in tables)
            await db.Database.ExecuteSqlRawAsync($"DELETE FROM \"{table}\"", ct);
#pragma warning restore EF1002
        await db.Database.ExecuteSqlAsync($"DELETE FROM SyncState WHERE Key = {SyncStateEntry.WatermarkKey}", ct);

        await SyncSql.SetStateAsync(db, SyncStateEntry.ApplyingKey, "0", ct);
        await transaction.CommitAsync(ct);
    }

    private async Task<TResponse> PostAsync<TRequest, TResponse>(string url, TRequest body, CancellationToken ct)
    {
        using var response = await http.PostAsJsonAsync(url, body, JsonOptions, ct);
        ThrowIfUnauthorized(response);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TResponse>(JsonOptions, ct))
               ?? throw new HttpRequestException($"Empty response from {url}.");
    }

    private static void ThrowIfUnauthorized(HttpResponseMessage response)
    {
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new SyncAuthorizationException();
    }
}
