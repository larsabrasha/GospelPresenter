using GospelPresenter.Client.Data;
using GospelPresenter.Client.Sync;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Bibles;

/// <summary>
/// Opt-in offline Bible translations. The sync pull carries Bible metadata only (VersesJson stays
/// "[]" locally — the column is megabytes per translation); this service fetches the verses from
/// GET /api/sync/bibles/{id} when the user asks, records the pin and the downloaded version in
/// SyncState, and re-downloads after a sync whenever the row's ModifiedAt moved past what was
/// downloaded. Writes run with sync tracking suppressed so the row keeps the server's stamp.
/// </summary>
public class BibleOfflineService(
    IDbContextFactory<ClientDataContext> contextFactory,
    HttpClient http,
    IBibleService bibleService,
    ILogger<BibleOfflineService> logger) : IBibleOfflineStore
{
    private static string PinKey(string bibleId) => $"bible-pinned:{bibleId}";
    private static string VersionKey(string bibleId) => $"bible-version:{bibleId}";

    public async Task<IReadOnlyDictionary<string, BibleOfflineState>> GetStatesAsync(
        string organizationId, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var bibles = await db.Bibles.AsNoTracking()
            .Where(b => b.OrganizationId == organizationId)
            .Select(b => new { b.Id, b.Abbreviation, HasVerses = b.VersesJson.Length > 2 })
            .ToListAsync(cancellationToken);
        var pinnedIds = (await db.SyncState.AsNoTracking()
                .Where(s => s.Key.StartsWith("bible-pinned:"))
                .Select(s => s.Key)
                .ToListAsync(cancellationToken))
            .Select(key => key["bible-pinned:".Length..])
            .ToHashSet();

        return bibles.ToDictionary(
            b => b.Abbreviation,
            b => !b.HasVerses ? BibleOfflineState.NotAvailable
                : pinnedIds.Contains(b.Id) ? BibleOfflineState.Downloaded
                : BibleOfflineState.ImportedLocally);
    }

    public async Task<bool> DownloadAsync(string organizationId, string abbreviation, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var bible = await db.Bibles
            .FirstOrDefaultAsync(b => b.OrganizationId == organizationId && b.Abbreviation == abbreviation, cancellationToken);
        if (bible is null)
            return false;

        var applied = await FetchAndStoreAsync(db, bible.Id, cancellationToken);
        if (!applied)
            return false;

        await SyncSql.SetStateAsync(db, PinKey(bible.Id), "1", cancellationToken);
        await bibleService.LoadBiblesAsync();
        return true;
    }

    public async Task RemoveAsync(string organizationId, string abbreviation, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var bible = await db.Bibles
            .FirstOrDefaultAsync(b => b.OrganizationId == organizationId && b.Abbreviation == abbreviation, cancellationToken);
        if (bible is null)
            return;

        db.ApplyingServerChanges = true;
        bible.VersesJson = "[]";
        await db.SaveChangesAsync(cancellationToken);
        db.ApplyingServerChanges = false;

        await db.Database.ExecuteSqlAsync(
            $"DELETE FROM SyncState WHERE Key = {PinKey(bible.Id)} OR Key = {VersionKey(bible.Id)}", cancellationToken);
        await bibleService.LoadBiblesAsync();
    }

    /// <summary>
    /// Re-downloads pinned translations whose metadata moved past the downloaded version — run
    /// after each sync, when the pull may have brought a new ModifiedAt for a pinned Bible.
    /// </summary>
    public async Task RefreshStaleAsync(CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var state = await db.SyncState.AsNoTracking()
            .Where(s => s.Key.StartsWith("bible-pinned:") || s.Key.StartsWith("bible-version:"))
            .ToListAsync(cancellationToken);
        var pinnedIds = state.Where(s => s.Key.StartsWith("bible-pinned:"))
            .Select(s => s.Key["bible-pinned:".Length..])
            .ToList();
        if (pinnedIds.Count == 0)
            return;
        var downloadedVersions = state.Where(s => s.Key.StartsWith("bible-version:"))
            .ToDictionary(s => s.Key["bible-version:".Length..], s => s.Value);

        var rows = await db.Bibles.AsNoTracking()
            .Where(b => pinnedIds.Contains(b.Id))
            .Select(b => new { b.Id, b.ModifiedAt })
            .ToListAsync(cancellationToken);

        var refreshed = false;
        foreach (var row in rows)
        {
            var current = row.ModifiedAt.ToString("O");
            if (downloadedVersions.TryGetValue(row.Id, out var downloaded) && downloaded == current)
                continue;
            refreshed |= await FetchAndStoreAsync(db, row.Id, cancellationToken);
        }

        if (refreshed)
            await bibleService.LoadBiblesAsync();
    }

    private async Task<bool> FetchAndStoreAsync(ClientDataContext db, string bibleId, CancellationToken cancellationToken)
    {
        string versesJson;
        try
        {
            using var response = await http.GetAsync($"/api/sync/bibles/{bibleId}", cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("The Bible download for {BibleId} answered {Status}", bibleId, response.StatusCode);
                return false;
            }
            versesJson = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (HttpRequestException e)
        {
            logger.LogInformation("The Bible download for {BibleId} could not reach the server: {Message}", bibleId, e.Message);
            return false;
        }

        var bible = await db.Bibles.FirstOrDefaultAsync(b => b.Id == bibleId, cancellationToken);
        if (bible is null)
            return false;

        db.ApplyingServerChanges = true;
        bible.VersesJson = versesJson;
        await db.SaveChangesAsync(cancellationToken);
        db.ApplyingServerChanges = false;

        await SyncSql.SetStateAsync(db, VersionKey(bibleId), bible.ModifiedAt.ToString("O"), cancellationToken);
        logger.LogInformation("Downloaded the verses of Bible {BibleId} ({Size} KB)", bibleId, versesJson.Length / 1024);
        return true;
    }
}
