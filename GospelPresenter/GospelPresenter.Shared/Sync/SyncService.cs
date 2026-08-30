using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;

namespace GospelPresenter.Shared.Sync;

/// <summary>
/// Serves the pull side of offline sync. The watermark is the server clock captured when the pull
/// starts; the query window is widened backwards by <see cref="SyncDefaults.PullOverlap"/> so rows
/// committed around the previous watermark cannot fall between two pulls, and bounded above by the
/// watermark so a page sequence stays stable while new writes arrive. Tables are served in a fixed
/// order with keyset paging on (ModifiedAt, Id); tombstones come last. The advertised watermark is
/// never ahead of what was actually served, so a backwards clock adjustment cannot hide changes.
/// </summary>
public class SyncService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    IObjectStorageService storage,
    IStringLocalizer<SharedResource> localizer,
    IPresentationService presentationService,
    ISongService songService,
    ISongPartLabelService songPartLabelService,
    IOrganizationImageService organizationImageService,
    IOrganizationAudioService organizationAudioService) : ISyncService
{
    /// <summary>Enums as names, matching how Theme.Definition is stored in its column.</summary>
    private static readonly JsonSerializerOptions ThemeJsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() }
    };

    private sealed record PullCursor(int Table, DateTimeOffset ModifiedAt, string Id);

    private sealed record TablePage(int Count, bool HasMore, DateTimeOffset LastModifiedAt, string LastId);

    // These numbers travel in the cursor, so they are append-only: an instance that hands out a
    // cursor mid-sequence may not be the one that reads it back, and reusing a number would apply
    // one table's keyset position to another table's rows — silently skipping everything below it.
    // The order rows are served in lives in PullOrder instead, which is free to change.
    private const int SongPartLabelsTable = 0;
    private const int SongsTable = 1;
    private const int SongPartsTable = 2;
    private const int SongArrangementsTable = 3;
    private const int SongVersionsTable = 4;
    private const int PresentationsTable = 5;
    private const int PresentationItemsTable = 6;
    private const int PresentationItemPartsTable = 7;
    private const int PresentationSlidesTable = 8;
    private const int ThemesTable = 9;
    private const int OverlaySlidesTable = 10;
    private const int OrganizationImagesTable = 11;
    private const int OrganizationAudiosTable = 12;
    private const int OrganizationSettingsTable = 13;
    private const int UserSettingsTable = 14;
    private const int BiblesTable = 15;
    private const int TombstonesTable = 16;
    private const int RemoteDisplaysTable = 17;

    /// <summary>
    /// The order tables are served in: referenced rows (labels, songs) before the rows pointing at
    /// them, so a client applying a page sequence never sees a dangling required reference for
    /// long, and tombstones last so a row is never deleted and then re-served in one pull.
    /// </summary>
    private static readonly int[] PullOrder =
    [
        SongPartLabelsTable, SongsTable, SongPartsTable, SongArrangementsTable, SongVersionsTable,
        PresentationsTable, PresentationItemsTable, PresentationItemPartsTable, PresentationSlidesTable,
        ThemesTable, OverlaySlidesTable, OrganizationImagesTable, OrganizationAudiosTable,
        OrganizationSettingsTable, UserSettingsTable, BiblesTable, RemoteDisplaysTable,
        TombstonesTable,
    ];

    public async Task<SyncPullResponse> PullAsync(string organizationId, SyncPullRequest request, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);

        var watermark = DateTimeOffset.UtcNow;
        var changes = new SyncChanges();
        var tombstones = new List<SyncTombstoneDto>();

        if (request.Since is not null && request.Since < watermark - SyncDefaults.FullResyncHorizon)
        {
            // The tombstone purge may already have eaten deletions this client never saw.
            return new SyncPullResponse(watermark, RequiresFullResync: true, HasMore: false,
                NextCursor: null, changes, tombstones);
        }

        var low = request.Since - SyncDefaults.PullOverlap;
        var cursor = DecodeCursor(request.Cursor);
        var remaining = Math.Clamp(request.Take, 1, SyncDefaults.MaxPullTake);

        await using var db = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var hasMore = false;
        string? nextCursor = null;
        DateTimeOffset maxServed = default;

        // A cursor naming a table this build does not serve restarts the sequence rather than
        // ending it: re-serving is harmless, silently skipping the rest of the tables is not.
        var start = cursor is null ? 0 : Math.Max(0, Array.IndexOf(PullOrder, cursor.Table));

        for (var i = start; i < PullOrder.Length; i++)
        {
            var table = PullOrder[i];
            var position = cursor is not null && table == cursor.Table ? cursor : null;
            var page = await PullTableAsync(db, table, organizationId, caller, low, watermark, position, remaining, changes, tombstones, cancellationToken);

            if (page.Count > 0 && page.LastModifiedAt > maxServed)
                maxServed = page.LastModifiedAt;
            remaining -= page.Count;

            if (page.HasMore || (remaining == 0 && i < PullOrder.Length - 1))
            {
                hasMore = true;
                nextCursor = EncodeCursor(new PullCursor(table, page.LastModifiedAt, page.LastId));
                break;
            }
        }

        // Advertise no more than was actually observed: if the clock later jumps backwards, a
        // watermark ahead of the data could make the next pull skip rows the client never saw.
        var advertised = hasMore || maxServed == default
            ? watermark
            : new DateTimeOffset(Math.Min(watermark.UtcTicks, (maxServed + SyncDefaults.PullOverlap).UtcTicks), TimeSpan.Zero);

        return new SyncPullResponse(advertised, RequiresFullResync: false, hasMore, nextCursor, changes, tombstones);
    }

    private async Task<TablePage> PullTableAsync(
        PresentationContext db, int table, string organizationId, CallerContext caller,
        DateTimeOffset? low, DateTimeOffset watermark, PullCursor? position, int remaining,
        SyncChanges changes, List<SyncTombstoneDto> tombstones, CancellationToken cancellationToken)
    {
        switch (table)
        {
            case SongPartLabelsTable when caller.HasPermission(Permission.ViewSongs):
                return await PageAsync(
                    Window(db.SongPartLabels.Where(l => l.OrganizationId == organizationId), low, watermark, position)
                        .Select(l => new SyncSongPartLabelDto(l.Id, l.Text, l.Color, l.SortOrder, l.ModifiedAt, l.Version)),
                    remaining, changes.SongPartLabels, cancellationToken);

            case SongsTable when caller.HasPermission(Permission.ViewSongs):
                return await PageAsync(
                    Window(db.Songs.Where(s => s.OrganizationId == organizationId), low, watermark, position)
                        .Select(s => new SyncSongDto(s.Id, s.Name, s.Author, s.Publisher, s.Year, s.Ccli, s.DeletedAt, s.ModifiedAt, s.Version)),
                    remaining, changes.Songs, cancellationToken);

            case SongPartsTable when caller.HasPermission(Permission.ViewSongs):
                return await PageAsync(
                    Window(db.SongParts.Where(p => p.Song.OrganizationId == organizationId), low, watermark, position)
                        .Select(p => new SyncSongPartDto(p.Id, p.LabelId, p.Content, p.SortOrder, p.SongId, p.ModifiedAt)),
                    remaining, changes.SongParts, cancellationToken);

            case SongArrangementsTable when caller.HasPermission(Permission.ViewSongs):
                return await PageAsync(
                    Window(db.SongArrangements.Where(a => a.Song.OrganizationId == organizationId), low, watermark, position)
                        .Select(a => new SyncSongArrangementDto(a.Id, a.Name, a.PartIdsJson, a.SongId, a.ModifiedAt)),
                    remaining, changes.SongArrangements, cancellationToken);

            case SongVersionsTable when caller.HasPermission(Permission.ViewSongs):
                return await PageAsync(
                    Window(db.SongVersions.Where(v => v.Song.OrganizationId == organizationId), low, watermark, position)
                        .Select(v => new SyncSongVersionDto(v.Id, v.SongId, v.CreatedAt, v.Name, v.Author, v.PartsJson, v.ModifiedAt)),
                    remaining, changes.SongVersions, cancellationToken);

            case PresentationsTable when caller.HasPermission(Permission.ViewPresentations):
                return await PageAsync(
                    Window(db.Presentations.Where(p => p.OrganizationId == organizationId), low, watermark, position)
                        .Select(p => new SyncPresentationDto(p.Id, p.Name, p.CreatedAt, p.CreatedBy,
                            p.UpdatedAt, p.UpdatedBy, p.IsTemplate, p.Description, p.LastUsedAt, p.UseCount,
                            p.ScheduledDayOfWeek, p.ScheduledTime, p.EventDate, p.EventTime, p.EventLocation,
                            p.ThemeId, p.ModifiedAt, p.Version)),
                    remaining, changes.Presentations, cancellationToken);

            case PresentationItemsTable when caller.HasPermission(Permission.ViewPresentations):
                return await PageAsync(
                    Window(db.PresentationItems.Where(i => i.Presentation.OrganizationId == organizationId), low, watermark, position)
                        .Select(i => new SyncPresentationItemDto(i.Id, i.SourceId, i.Type, i.Title, i.ArrangementId, i.SortOrder, i.PresentationId, i.ModifiedAt)),
                    remaining, changes.PresentationItems, cancellationToken);

            case PresentationItemPartsTable when caller.HasPermission(Permission.ViewPresentations):
                return await PageAsync(
                    Window(db.PresentationItemParts.Where(p => p.PresentationItem.Presentation.OrganizationId == organizationId), low, watermark, position)
                        .Select(p => new SyncPresentationItemPartDto(p.Id, p.Content, p.SortOrder, p.PresentationItemId, p.ModifiedAt)),
                    remaining, changes.PresentationItemParts, cancellationToken);

            case PresentationSlidesTable when caller.HasPermission(Permission.ViewPresentations):
                return await PageAsync(
                    Window(db.PresentationSlides.Where(s => s.Presentation.OrganizationId == organizationId), low, watermark, position)
                        .Select(s => new SyncPresentationSlidesDto(s.Id, s.FileName, s.PageCount, s.CreatedAt, s.PresentationId, s.ModifiedAt)),
                    remaining, changes.PresentationSlides, cancellationToken);

            case ThemesTable when caller.HasPermission(Permission.ViewThemes):
            {
                // The definition column deserializes into SlideTheme on materialization and cannot
                // be re-serialized inside a SQL projection, so themes are fetched as entities.
                // Built-in themes (null organisation) sync to every client.
                var entities = await Window(
                        db.Themes.Where(t => t.OrganizationId == organizationId || t.OrganizationId == null),
                        low, watermark, position)
                    .Take(remaining + 1)
                    .ToListAsync(cancellationToken);
                var hasMore = entities.Count > remaining;
                if (hasMore) entities.RemoveAt(remaining);
                changes.Themes.AddRange(entities.Select(t => new SyncThemeDto(
                    t.Id, t.OrganizationId, t.Name, t.SortOrder,
                    JsonSerializer.Serialize(t.Definition, ThemeJsonOptions), t.ModifiedAt)));
                var last = entities.Count > 0 ? entities[^1] : null;
                return new TablePage(entities.Count, hasMore, last?.ModifiedAt ?? default, last?.Id ?? "");
            }

            case OverlaySlidesTable when caller.HasPermission(Permission.ViewOverlays):
                return await PageAsync(
                    Window(db.OverlaySlides.Where(o => o.OrganizationId == organizationId), low, watermark, position)
                        .Select(o => new SyncOverlaySlideDto(o.Id, o.Title, o.Content, o.HasImage, o.SortOrder, o.ModifiedAt, o.Version)),
                    remaining, changes.OverlaySlides, cancellationToken);

            case OrganizationImagesTable when caller.HasPermission(Permission.ViewOrganizationImages):
                return await PageAsync(
                    Window(db.OrganizationImages.Where(i => i.OrganizationId == organizationId), low, watermark, position)
                        .Select(i => new SyncOrganizationImageDto(i.Id, i.FileName, i.ContentType, i.CreatedAt, i.ModifiedAt, i.Version)),
                    remaining, changes.OrganizationImages, cancellationToken);

            case OrganizationAudiosTable when caller.HasPermission(Permission.ViewOrganizationAudios):
                return await PageAsync(
                    Window(db.OrganizationAudios.Where(a => a.OrganizationId == organizationId), low, watermark, position)
                        .Select(a => new SyncOrganizationAudioDto(a.Id, a.FileName, a.ContentType, a.CreatedAt, a.ModifiedAt, a.Version)),
                    remaining, changes.OrganizationAudios, cancellationToken);

            case OrganizationSettingsTable:
                // Reading organisation settings is gated on membership alone, matching
                // OrganizationSettingService.GetSettingAsync.
                return await PageAsync(
                    Window(db.OrganizationSettings.Where(s => s.OrganizationId == organizationId), low, watermark, position)
                        .Select(s => new SyncOrganizationSettingDto(s.Id, s.Key, s.Value, s.ModifiedAt, s.Version)),
                    remaining, changes.OrganizationSettings, cancellationToken);

            case UserSettingsTable:
                return await PageAsync(
                    Window(db.UserSettings.Where(s => s.UserId == caller.UserId), low, watermark, position)
                        .Select(s => new SyncUserSettingDto(s.Id, s.Key, s.Value, s.ModifiedAt, s.Version)),
                    remaining, changes.UserSettings, cancellationToken);

            case BiblesTable when caller.HasPermission(Permission.ViewBibles):
                // Metadata only: VersesJson is never part of the projection, so the multi-megabyte
                // column stays out of the query entirely.
                return await PageAsync(
                    Window(db.Bibles.Where(b => b.OrganizationId == organizationId), low, watermark, position)
                        .Select(b => new SyncBibleDto(b.Id, b.Name, b.Abbreviation, b.VerseCount, b.ModifiedAt)),
                    remaining, changes.Bibles, cancellationToken);

            case RemoteDisplaysTable when caller.HasPermission(Permission.ViewPresentations):
                // Same gate as RemoteDisplayService.GetDisplaysAsync: seeing which outputs exist is
                // part of seeing the presentations they show.
                return await PageAsync(
                    Window(db.RemoteDisplays.Where(d => d.OrganizationId == organizationId), low, watermark, position)
                        .Select(d => new SyncRemoteDisplayDto(d.Id, d.DisplayIdentifier, d.Name, d.Kind, d.CreatedAt, d.ModifiedAt, d.Version)),
                    remaining, changes.RemoteDisplays, cancellationToken);

            case TombstonesTable:
            {
                var query = db.SyncTombstones
                    .Where(t => t.OrganizationId == organizationId
                                || t.OrganizationId == null
                                || t.UserId == caller.UserId)
                    .Where(t => t.DeletedAt <= watermark);
                if (low is not null)
                    query = query.Where(t => t.DeletedAt > low.Value);
                if (position is not null)
                    query = query.Where(t => t.DeletedAt > position.ModifiedAt
                        || (t.DeletedAt == position.ModifiedAt && string.Compare(t.Id, position.Id) > 0));

                var rows = await query
                    .OrderBy(t => t.DeletedAt).ThenBy(t => t.Id)
                    .Take(remaining + 1)
                    .ToListAsync(cancellationToken);
                var hasMore = rows.Count > remaining;
                if (hasMore) rows.RemoveAt(remaining);
                tombstones.AddRange(rows.Select(t => new SyncTombstoneDto(t.EntityType, t.EntityId, t.DeletedAt)));
                var last = rows.Count > 0 ? rows[^1] : null;
                return new TablePage(rows.Count, hasMore, last?.DeletedAt ?? default, last?.Id ?? "");
            }

            default:
                // A table the caller may not read is simply absent from their pull.
                return new TablePage(0, false, default, "");
        }
    }

    /// <summary>Applies the change window and keyset position, ordered by (ModifiedAt, Id).</summary>
    private static IQueryable<TEntity> Window<TEntity>(
        IQueryable<TEntity> source, DateTimeOffset? low, DateTimeOffset watermark, PullCursor? position)
        where TEntity : class, ISyncTracked
    {
        var query = source.Where(e => EF.Property<DateTimeOffset>(e, nameof(ISyncTracked.ModifiedAt)) <= watermark);
        if (low is not null)
            query = query.Where(e => EF.Property<DateTimeOffset>(e, nameof(ISyncTracked.ModifiedAt)) > low.Value);
        if (position is not null)
            query = query.Where(e =>
                EF.Property<DateTimeOffset>(e, nameof(ISyncTracked.ModifiedAt)) > position.ModifiedAt
                || (EF.Property<DateTimeOffset>(e, nameof(ISyncTracked.ModifiedAt)) == position.ModifiedAt
                    && string.Compare(EF.Property<string>(e, "Id"), position.Id) > 0));

        return query
            .OrderBy(e => EF.Property<DateTimeOffset>(e, nameof(ISyncTracked.ModifiedAt)))
            .ThenBy(e => EF.Property<string>(e, "Id"));
    }

    private static async Task<TablePage> PageAsync<TDto>(
        IQueryable<TDto> ordered, int remaining, List<TDto> target, CancellationToken cancellationToken)
        where TDto : class, ISyncRow
    {
        var rows = await ordered.Take(remaining + 1).ToListAsync(cancellationToken);
        var hasMore = rows.Count > remaining;
        if (hasMore) rows.RemoveAt(remaining);
        target.AddRange(rows);
        var last = rows.Count > 0 ? rows[^1] : null;
        return new TablePage(rows.Count, hasMore, last?.ModifiedAt ?? default, last?.Id ?? "");
    }

    public async Task<SyncPushResponse> PushAsync(string organizationId, SyncPushRequest request, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);

        var results = new List<SyncPushResult>();
        await using var db = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Labels a pushed row referenced by an id the server had to remap (same text, different id).
        var labelRemap = new Dictionary<string, string>();
        var validLabelIds = (await db.SongPartLabels
                .Where(l => l.OrganizationId == organizationId)
                .Select(l => l.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();
        var songsChanged = false;

        // Referenced rows before rows pointing at them: labels → songs → media → overlays →
        // presentations → settings → deletes. Each aggregate is its own unit of work; a failing
        // one is rolled back and reported without taking the rest of the batch with it.
        foreach (var push in request.SongPartLabels)
        {
            results.Add(await GuardAsync(db, nameof(DbSongPartLabel), push.Row.Id, () =>
                ProcessLabelPushAsync(db, organizationId, push, labelRemap, validLabelIds, caller, cancellationToken)));
            songsChanged = true;
        }

        foreach (var push in request.Songs)
        {
            results.Add(await GuardAsync(db, nameof(DbSong), push.Song.Id, () =>
                ProcessSongPushAsync(db, organizationId, push, labelRemap, validLabelIds, caller, cancellationToken)));
            songsChanged = true;
        }

        foreach (var push in request.OrganizationImages)
        {
            results.Add(await GuardAsync(db, nameof(OrganizationImage), push.Row.Id, () =>
                ProcessImagePushAsync(db, organizationId, push, caller, cancellationToken)));
        }

        foreach (var push in request.OrganizationAudios)
        {
            results.Add(await GuardAsync(db, nameof(OrganizationAudio), push.Row.Id, () =>
                ProcessAudioPushAsync(db, organizationId, push, caller, cancellationToken)));
        }

        foreach (var push in request.OverlaySlides)
        {
            results.Add(await GuardAsync(db, nameof(OverlaySlide), push.Row.Id, () =>
                ProcessOverlayPushAsync(db, organizationId, push, caller, cancellationToken)));
        }

        foreach (var push in request.Presentations)
        {
            results.Add(await GuardAsync(db, nameof(Presentation), push.Presentation.Id, () =>
                ProcessPresentationPushAsync(db, organizationId, push, caller, cancellationToken)));
        }

        foreach (var push in request.OrganizationSettings)
        {
            results.Add(await GuardAsync(db, nameof(OrganizationSetting), push.Row.Id, () =>
                ProcessOrganizationSettingPushAsync(db, organizationId, push, caller, cancellationToken)));
        }

        foreach (var push in request.UserSettings)
        {
            results.Add(await GuardAsync(db, nameof(UserSetting), push.Row.Id, () =>
                ProcessUserSettingPushAsync(db, push, caller, cancellationToken)));
        }

        foreach (var push in request.RemoteDisplays)
        {
            results.Add(await GuardAsync(db, nameof(RemoteDisplay), push.Row.Id, () =>
                ProcessRemoteDisplayPushAsync(db, organizationId, push, caller, cancellationToken)));
        }

        foreach (var delete in request.Deletes)
        {
            var result = await GuardAsync(db, delete.EntityType, delete.Id, () =>
                ProcessDeleteAsync(db, organizationId, delete, caller, cancellationToken));
            results.Add(result);
            if (delete.EntityType is nameof(DbSong) or nameof(DbSongPartLabel) && result.Outcome == SyncPushOutcome.Applied)
                songsChanged = true;
        }

        // The web UI reads songs from SongService's in-memory cache; a push that changed songs or
        // labels must refresh it, or the server's own screens would show stale data.
        if (songsChanged)
            await songService.LoadSongsAsync();

        return new SyncPushResponse(results);
    }

    public async Task<string?> GetBibleVersesJsonAsync(string organizationId, string bibleId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewBibles);
        caller.RequireOrganizationAccess(organizationId);

        await using var db = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        return await db.Bibles
            .Where(b => b.Id == bibleId && b.OrganizationId == organizationId)
            .Select(b => b.VersesJson)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Runs one push unit, turning validation and permission failures into a Failed result instead
    /// of failing the whole batch, and leaving the shared change tracker clean for the next unit.
    /// </summary>
    private static async Task<SyncPushResult> GuardAsync(
        PresentationContext db, string entityType, string id, Func<Task<SyncPushResult>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception e) when (e is InvalidOperationException or UnauthorizedAccessException or DbUpdateException)
        {
            return new SyncPushResult(entityType, id, SyncPushOutcome.Failed, Warning: e.Message);
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
    }

    private async Task<SyncPushResult> ProcessLabelPushAsync(
        PresentationContext db, string organizationId, SyncRowPush<SyncSongPartLabelDto> push,
        Dictionary<string, string> labelRemap, HashSet<string> validLabelIds, CallerContext caller,
        CancellationToken cancellationToken)
    {
        caller.RequirePermission(Permission.ManageSongs);
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.Text, AppConstraints.SongPartLabelTextMaxLength, "Text");
        ValidationHelper.RequireMaxLength(row.Color, AppConstraints.SongPartLabelColorMaxLength, "Color");

        var existing = await db.SongPartLabels
            .FirstOrDefaultAsync(l => l.Id == row.Id && l.OrganizationId == organizationId, cancellationToken);

        if (existing is null)
        {
            // Label text is unique per organisation: an offline client and the server can both
            // invent "Bridge" with different ids. The server's row survives; the client is told to
            // repoint its references, and songs later in this batch are remapped here.
            var sameText = await db.SongPartLabels
                .FirstOrDefaultAsync(l => l.OrganizationId == organizationId && l.Text == row.Text, cancellationToken);
            if (sameText is not null)
            {
                labelRemap[row.Id] = sameText.Id;
                return new SyncPushResult(nameof(DbSongPartLabel), row.Id, SyncPushOutcome.Remapped, NewId: sameText.Id);
            }

            if (push.BaseVersion is not null && await HasTombstoneAsync(db, nameof(DbSongPartLabel), row.Id, cancellationToken))
                return new SyncPushResult(nameof(DbSongPartLabel), row.Id, SyncPushOutcome.ServerWins, Warning: "Deleted on the server.");

            var label = new DbSongPartLabel
            {
                Id = row.Id,
                Text = row.Text,
                Color = row.Color,
                SortOrder = row.SortOrder,
                OrganizationId = organizationId,
            };
            db.SongPartLabels.Add(label);
            await db.SaveChangesAsync(cancellationToken);
            validLabelIds.Add(row.Id);
            return new SyncPushResult(nameof(DbSongPartLabel), row.Id, SyncPushOutcome.Applied, NewVersion: label.Version);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(DbSongPartLabel), row.Id, SyncPushOutcome.ServerWins);

        existing.Text = row.Text;
        existing.Color = row.Color;
        existing.SortOrder = row.SortOrder;
        await db.SaveChangesAsync(cancellationToken);
        return new SyncPushResult(nameof(DbSongPartLabel), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version);
    }

    private async Task<SyncPushResult> ProcessSongPushAsync(
        PresentationContext db, string organizationId, SyncSongPush push,
        Dictionary<string, string> labelRemap, HashSet<string> validLabelIds, CallerContext caller,
        CancellationToken cancellationToken)
    {
        caller.RequirePermission(Permission.ManageSongs);
        var dto = push.Song;
        ValidateSong(dto, push.Parts, push.Arrangements);

        var existing = await db.Songs
            .Include(s => s.Parts)
            .Include(s => s.Arrangements)
            .FirstOrDefaultAsync(s => s.Id == dto.Id && s.OrganizationId == organizationId, cancellationToken);

        if (existing is null)
        {
            if (push.BaseVersion is not null && await HasTombstoneAsync(db, nameof(DbSong), dto.Id, cancellationToken))
                return new SyncPushResult(nameof(DbSong), dto.Id, SyncPushOutcome.ServerWins, Warning: "Deleted on the server.");

            await ValidationHelper.RequireMaxCountAsync(
                db.Songs.Where(s => s.OrganizationId == organizationId && s.DeletedAt == null),
                AppConstraints.MaxSongsPerOrg, "songs", cancellationToken);

            var song = new DbSong
            {
                Id = dto.Id,
                Name = dto.Name,
                Author = dto.Author,
                Publisher = dto.Publisher,
                Year = dto.Year,
                Ccli = dto.Ccli,
                DeletedAt = dto.DeletedAt,
                OrganizationId = organizationId,
            };
            foreach (var part in push.Parts.OrderBy(p => p.SortOrder))
            {
                song.Parts.Add(new DbSongPart
                {
                    Id = part.Id,
                    LabelId = ResolveLabelId(part.LabelId, labelRemap, validLabelIds),
                    Content = part.Content,
                    SortOrder = part.SortOrder,
                });
            }
            foreach (var arrangement in push.Arrangements)
            {
                song.Arrangements.Add(new DbSongArrangement
                {
                    Id = arrangement.Id,
                    Name = arrangement.Name,
                    PartIdsJson = arrangement.PartIdsJson,
                    SongId = dto.Id,
                });
            }
            db.Songs.Add(song);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(DbSong), dto.Id, SyncPushOutcome.Applied, NewVersion: song.Version);
        }

        if (push.BaseVersion != existing.Version)
        {
            // The song is the user's work: the server version stands, but the pushed state is
            // appended to the song's version history so nothing composed offline is lost.
            await AppendConflictVersionAsync(db, existing.Id, dto, push.Parts, cancellationToken);
            return new SyncPushResult(nameof(DbSong), dto.Id, SyncPushOutcome.ServerWins,
                Warning: "The pushed state was saved to the song's version history.",
                ServerState: ProjectSong(existing));
        }

        existing.Name = dto.Name;
        existing.Author = dto.Author;
        existing.Publisher = dto.Publisher;
        existing.Year = dto.Year;
        existing.Ccli = dto.Ccli;
        existing.DeletedAt = dto.DeletedAt;

        var pushedPartIds = push.Parts.Select(p => p.Id).ToHashSet();
        foreach (var gone in existing.Parts.Where(p => !pushedPartIds.Contains(p.Id)).ToList())
            db.SongParts.Remove(gone);
        foreach (var partDto in push.Parts)
        {
            var part = existing.Parts.FirstOrDefault(p => p.Id == partDto.Id);
            if (part is null)
            {
                part = new DbSongPart { Id = partDto.Id, SongId = existing.Id };
                db.SongParts.Add(part);
            }
            part.LabelId = ResolveLabelId(partDto.LabelId, labelRemap, validLabelIds);
            part.Content = partDto.Content;
            part.SortOrder = partDto.SortOrder;
        }

        var pushedArrangementIds = push.Arrangements.Select(a => a.Id).ToHashSet();
        foreach (var gone in existing.Arrangements.Where(a => !pushedArrangementIds.Contains(a.Id)).ToList())
            db.SongArrangements.Remove(gone);
        foreach (var arrangementDto in push.Arrangements)
        {
            var arrangement = existing.Arrangements.FirstOrDefault(a => a.Id == arrangementDto.Id);
            if (arrangement is null)
            {
                arrangement = new DbSongArrangement { Id = arrangementDto.Id, SongId = existing.Id };
                db.SongArrangements.Add(arrangement);
            }
            arrangement.Name = arrangementDto.Name;
            arrangement.PartIdsJson = arrangementDto.PartIdsJson;
        }

        // Touch: child changes move the aggregate version even when no song field changed.
        existing.ModifiedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return new SyncPushResult(nameof(DbSong), dto.Id, SyncPushOutcome.Applied, NewVersion: existing.Version);
    }

    private async Task<SyncPushResult> ProcessPresentationPushAsync(
        PresentationContext db, string organizationId, SyncPresentationPush push, CallerContext caller,
        CancellationToken cancellationToken)
    {
        var dto = push.Presentation;
        caller.RequirePermission(dto.IsTemplate ? Permission.ManageTemplates : Permission.ManagePresentations);
        ValidatePresentation(dto, push.Items, push.Parts);

        var warnings = new List<string>();
        var themeId = await ResolveThemeIdAsync(db, organizationId, dto.ThemeId, warnings, cancellationToken);

        var existing = await db.Presentations
            .Include(p => p.Items).ThenInclude(i => i.Parts)
            .Include(p => p.SlideDecks)
            .FirstOrDefaultAsync(p => p.Id == dto.Id && p.OrganizationId == organizationId, cancellationToken);

        if (existing is null && push.BaseVersion is null)
        {
            await RequirePresentationCapacityAsync(db, organizationId, dto.IsTemplate, cancellationToken);

            var now = DateTimeOffset.UtcNow;
            var presentation = new Presentation
            {
                Id = dto.Id,
                Name = dto.Name,
                IsTemplate = dto.IsTemplate,
                Description = dto.Description,
                ScheduledDayOfWeek = dto.ScheduledDayOfWeek,
                ScheduledTime = dto.ScheduledTime,
                EventDate = dto.EventDate,
                EventTime = dto.EventTime,
                EventLocation = dto.EventLocation,
                ThemeId = themeId,
                OrganizationId = organizationId,
                CreatedAt = now,
                CreatedBy = caller.UserId,
                UpdatedAt = now,
                UpdatedBy = caller.UserId,
            };
            db.Presentations.Add(presentation);
            AddPushedChildren(db, presentation.Id, push, slidesIdMap: null);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(Presentation), dto.Id, SyncPushOutcome.Applied,
                Warning: JoinWarnings(warnings), NewVersion: presentation.Version);
        }

        if (existing is null)
        {
            // Deleted on the server while the client was away. Deletion wins; the tombstone in the
            // ordinary pull is what removes it locally, so there is no state to hand back.
            return new SyncPushResult(nameof(Presentation), dto.Id, SyncPushOutcome.ServerWins,
                Warning: JoinWarnings(warnings));
        }

        if (push.BaseVersion != existing.Version)
        {
            // Both sides moved. Merge instead of picking a winner — see MergePresentationAsync.
            return await MergePresentationAsync(
                db, organizationId, existing, push, themeId, caller, warnings, cancellationToken);
        }

        existing.Name = dto.Name;
        existing.Description = dto.Description;
        existing.ScheduledDayOfWeek = dto.ScheduledDayOfWeek;
        existing.ScheduledTime = dto.ScheduledTime;
        existing.EventDate = dto.EventDate;
        existing.EventTime = dto.EventTime;
        existing.EventLocation = dto.EventLocation;
        existing.ThemeId = themeId;
        existing.UpdatedAt = DateTimeOffset.UtcNow;
        existing.UpdatedBy = caller.UserId;

        var pushedItemIds = push.Items.Select(i => i.Id).ToHashSet();
        foreach (var gone in existing.Items.Where(i => !pushedItemIds.Contains(i.Id)).ToList())
            db.PresentationItems.Remove(gone);
        foreach (var itemDto in push.Items)
        {
            var item = existing.Items.FirstOrDefault(i => i.Id == itemDto.Id);
            if (item is null)
            {
                item = new PresentationItem { Id = itemDto.Id, PresentationId = existing.Id };
                db.PresentationItems.Add(item);
                existing.Items.Add(item);
            }
            item.SourceId = itemDto.SourceId;
            item.Type = itemDto.Type;
            item.Title = itemDto.Title;
            item.ArrangementId = itemDto.ArrangementId;
            item.SortOrder = itemDto.SortOrder;
        }

        var allExistingParts = existing.Items.SelectMany(i => i.Parts).ToList();
        var pushedPartIds = push.Parts.Select(p => p.Id).ToHashSet();
        foreach (var gone in allExistingParts.Where(p => !pushedPartIds.Contains(p.Id)))
            db.PresentationItemParts.Remove(gone);
        foreach (var partDto in push.Parts)
        {
            var part = allExistingParts.FirstOrDefault(p => p.Id == partDto.Id);
            if (part is null)
            {
                part = new PresentationItemPart { Id = partDto.Id };
                db.PresentationItemParts.Add(part);
            }
            part.Content = partDto.Content;
            part.SortOrder = partDto.SortOrder;
            part.PresentationItemId = partDto.PresentationItemId;
        }

        var pushedSlidesIds = push.SlideDecks.Select(s => s.Id).ToHashSet();
        var removedSlidesIds = new List<string>();
        foreach (var gone in existing.SlideDecks.Where(s => !pushedSlidesIds.Contains(s.Id)).ToList())
        {
            removedSlidesIds.Add(gone.Id);
            db.PresentationSlides.Remove(gone);
        }
        foreach (var slidesDto in push.SlideDecks)
        {
            var slides = existing.SlideDecks.FirstOrDefault(s => s.Id == slidesDto.Id);
            if (slides is null)
            {
                slides = new PresentationSlides { Id = slidesDto.Id, PresentationId = existing.Id, CreatedAt = slidesDto.CreatedAt };
                db.PresentationSlides.Add(slides);
            }
            slides.FileName = slidesDto.FileName;
            slides.PageCount = slidesDto.PageCount;
        }

        await db.SaveChangesAsync(cancellationToken);

        foreach (var slidesId in removedSlidesIds)
            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, slidesId), cancellationToken);

        return new SyncPushResult(nameof(Presentation), dto.Id, SyncPushOutcome.Applied,
            Warning: JoinWarnings(warnings), NewVersion: existing.Version);
    }

    /// <summary>
    /// Materialises a pushed presentation as a brand-new one with fresh ids — the conflict policy's
    /// "(offline changes)" copy. Slides get new ids with their S3 pages copied from the originals
    /// where those exist; a deck created offline has no server pages yet, which is tolerated the
    /// same way dangling SourceIds are.
    /// </summary>
    /// <summary>
    /// Combines a pushed presentation with the server's, when both have changed since the client
    /// last saw it.
    ///
    /// The rules, and what each one costs:
    ///
    /// - Items, parts and slide decks are UNIONED by id. Anything either side has survives. This is
    ///   the rule that matters: the ordinary conflict here is one person renaming the service while
    ///   another adds a song, and neither of them is wrong.
    /// - A row both sides have takes the copy with the newer ModifiedAt. Last writer wins per row,
    ///   not per presentation, so an edit to verse 2 does not fight an edit to the title.
    /// - The presentation's own fields likewise follow the newer ModifiedAt of the two.
    /// - A row only the client has is kept, UNLESS a tombstone says the server deleted it. Deletion
    ///   is a decision someone made; re-creating it silently would be worse than losing an edit.
    ///
    /// THE COST, stated plainly: a row only the SERVER has is kept, which means an item the client
    /// deleted offline comes back if someone else touched the presentation in the meantime. The push
    /// carries the client's current state, not what it removed, so "the client deleted it" and "the
    /// server added it" look identical from here. Additions win over deletions, which is the gentler
    /// failure — an extra song in the running order is visible and removable, a missing one is
    /// noticed on stage.
    ///
    /// This applies ONLY on the conflict path. With no concurrent edit the ordinary apply runs and
    /// deletions work exactly as expected, which is very nearly always.
    ///
    /// Carrying removed ids in the push would make the whole thing exact and is the obvious next
    /// step if the resurrection ever actually annoys someone. The journal already knows them.
    /// </summary>
    private async Task<SyncPushResult> MergePresentationAsync(
        PresentationContext db, string organizationId, Presentation existing, SyncPresentationPush push,
        string? themeId, CallerContext caller, List<string> warnings, CancellationToken cancellationToken)
    {
        var dto = push.Presentation;
        var clientIsNewer = dto.ModifiedAt > existing.ModifiedAt;

        if (clientIsNewer)
        {
            existing.Name = dto.Name;
            existing.Description = dto.Description;
            existing.ScheduledDayOfWeek = dto.ScheduledDayOfWeek;
            existing.ScheduledTime = dto.ScheduledTime;
            existing.EventDate = dto.EventDate;
            existing.EventTime = dto.EventTime;
            existing.EventLocation = dto.EventLocation;
            existing.ThemeId = themeId;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
            existing.UpdatedBy = caller.UserId;
        }

        foreach (var itemDto in push.Items)
        {
            var item = existing.Items.FirstOrDefault(i => i.Id == itemDto.Id);
            if (item is null)
            {
                if (await HasTombstoneAsync(db, nameof(PresentationItem), itemDto.Id, cancellationToken))
                    continue;

                // Added to the tracked collection only. Adding to the DbSet as well would leave the
                // navigation holding the same item twice after fixup, which the projection below
                // would faithfully report to the client.
                item = new PresentationItem { Id = itemDto.Id, PresentationId = existing.Id };
                existing.Items.Add(item);
            }
            else if (itemDto.ModifiedAt <= item.ModifiedAt)
            {
                continue;
            }

            item.SourceId = itemDto.SourceId;
            item.Type = itemDto.Type;
            item.Title = itemDto.Title;
            item.ArrangementId = itemDto.ArrangementId;
            item.SortOrder = itemDto.SortOrder;
        }

        var allExistingParts = existing.Items.SelectMany(i => i.Parts).ToList();
        foreach (var partDto in push.Parts)
        {
            var part = allExistingParts.FirstOrDefault(p => p.Id == partDto.Id);
            if (part is null)
            {
                if (await HasTombstoneAsync(db, nameof(PresentationItemPart), partDto.Id, cancellationToken))
                    continue;

                // Its item may itself have been dropped as tombstoned just above.
                if (existing.Items.All(i => i.Id != partDto.PresentationItemId))
                    continue;

                part = new PresentationItemPart { Id = partDto.Id, PresentationItemId = partDto.PresentationItemId };
                existing.Items.Single(i => i.Id == partDto.PresentationItemId).Parts.Add(part);
            }
            else if (partDto.ModifiedAt <= part.ModifiedAt)
            {
                continue;
            }

            part.Content = partDto.Content;
            part.SortOrder = partDto.SortOrder;
            part.PresentationItemId = partDto.PresentationItemId;
        }

        foreach (var slidesDto in push.SlideDecks)
        {
            var slides = existing.SlideDecks.FirstOrDefault(s => s.Id == slidesDto.Id);
            if (slides is null)
            {
                if (await HasTombstoneAsync(db, nameof(PresentationSlides), slidesDto.Id, cancellationToken))
                    continue;

                slides = new PresentationSlides
                {
                    Id = slidesDto.Id, PresentationId = existing.Id, CreatedAt = slidesDto.CreatedAt,
                };
                existing.SlideDecks.Add(slides);
            }
            else if (slidesDto.ModifiedAt <= slides.ModifiedAt)
            {
                continue;
            }

            slides.FileName = slidesDto.FileName;
            slides.PageCount = slidesDto.PageCount;
        }

        // Nothing is deleted here, so no blobs are orphaned and none may be removed.
        await db.SaveChangesAsync(cancellationToken);

        return new SyncPushResult(nameof(Presentation), dto.Id, SyncPushOutcome.Merged,
            Warning: JoinWarnings(warnings),
            NewVersion: existing.Version,
            ServerState: ProjectPresentation(existing));
    }

    /// <summary>The server's song, in the shape a pull delivers. See <see cref="ProjectPresentation"/>.</summary>
    private static SyncChanges ProjectSong(DbSong song)
    {
        var changes = new SyncChanges();
        changes.Songs.Add(new SyncSongDto(
            song.Id, song.Name, song.Author, song.Publisher, song.Year, song.Ccli, song.DeletedAt,
            song.ModifiedAt, song.Version));

        foreach (var part in song.Parts)
            changes.SongParts.Add(new SyncSongPartDto(
                part.Id, part.LabelId, part.Content, part.SortOrder, part.SongId, part.ModifiedAt));

        foreach (var arrangement in song.Arrangements)
            changes.SongArrangements.Add(new SyncSongArrangementDto(
                arrangement.Id, arrangement.Name, arrangement.PartIdsJson, arrangement.SongId,
                arrangement.ModifiedAt));

        return changes;
    }

    /// <summary>
    /// The server's presentation in the shape a pull delivers, so the client can apply it with the
    /// applier it already has rather than a second code path that would drift from the first.
    /// </summary>
    private static SyncChanges ProjectPresentation(Presentation presentation)
    {
        var changes = new SyncChanges();
        changes.Presentations.Add(new SyncPresentationDto(
            presentation.Id, presentation.Name, presentation.CreatedAt, presentation.CreatedBy,
            presentation.UpdatedAt, presentation.UpdatedBy, presentation.IsTemplate,
            presentation.Description, presentation.LastUsedAt, presentation.UseCount,
            presentation.ScheduledDayOfWeek, presentation.ScheduledTime, presentation.EventDate,
            presentation.EventTime, presentation.EventLocation, presentation.ThemeId,
            presentation.ModifiedAt, presentation.Version));

        foreach (var item in presentation.Items)
        {
            changes.PresentationItems.Add(new SyncPresentationItemDto(
                item.Id, item.SourceId, item.Type, item.Title, item.ArrangementId, item.SortOrder,
                item.PresentationId, item.ModifiedAt));

            foreach (var part in item.Parts)
                changes.PresentationItemParts.Add(new SyncPresentationItemPartDto(
                    part.Id, part.Content, part.SortOrder, part.PresentationItemId, part.ModifiedAt));
        }

        foreach (var slides in presentation.SlideDecks)
            changes.PresentationSlides.Add(new SyncPresentationSlidesDto(
                slides.Id, slides.FileName, slides.PageCount, slides.CreatedAt,
                slides.PresentationId, slides.ModifiedAt));

        return changes;
    }

    /// <summary>
    /// Adds a pushed aggregate's items, parts and slide decks under the given presentation id.
    /// With a slides id map (the conflict copy), children get fresh ids and Slides items are
    /// repointed; without one (a new push), the client's ids are kept as-is.
    /// </summary>
    private static void AddPushedChildren(
        PresentationContext db, string presentationId, SyncPresentationPush push,
        Dictionary<string, string>? slidesIdMap)
    {
        foreach (var slidesDto in push.SlideDecks)
        {
            db.PresentationSlides.Add(new PresentationSlides
            {
                Id = slidesIdMap?.GetValueOrDefault(slidesDto.Id) ?? slidesDto.Id,
                FileName = slidesDto.FileName,
                PageCount = slidesDto.PageCount,
                CreatedAt = slidesDto.CreatedAt,
                PresentationId = presentationId,
            });
        }

        var partsByItem = push.Parts.ToLookup(p => p.PresentationItemId);
        foreach (var itemDto in push.Items)
        {
            var itemId = slidesIdMap is null ? itemDto.Id : Guid.NewGuid().ToString();
            var sourceId = itemDto.Type == PresentationItemType.Slides && itemDto.SourceId is not null
                ? slidesIdMap?.GetValueOrDefault(itemDto.SourceId) ?? itemDto.SourceId
                : itemDto.SourceId;

            db.PresentationItems.Add(new PresentationItem
            {
                Id = itemId,
                SourceId = sourceId,
                Type = itemDto.Type,
                Title = itemDto.Title,
                ArrangementId = itemDto.ArrangementId,
                SortOrder = itemDto.SortOrder,
                PresentationId = presentationId,
            });

            foreach (var partDto in partsByItem[itemDto.Id])
            {
                db.PresentationItemParts.Add(new PresentationItemPart
                {
                    Id = slidesIdMap is null ? partDto.Id : Guid.NewGuid().ToString(),
                    Content = partDto.Content,
                    SortOrder = partDto.SortOrder,
                    PresentationItemId = itemId,
                });
            }
        }
    }

    private async Task<SyncPushResult> ProcessImagePushAsync(
        PresentationContext db, string organizationId, SyncRowPush<SyncOrganizationImageDto> push,
        CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(Permission.ManageOrganizationImages);
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.FileName, AppConstraints.FileNameMaxLength, "FileName");

        var existing = await db.OrganizationImages
            .FirstOrDefaultAsync(i => i.Id == row.Id && i.OrganizationId == organizationId, cancellationToken);

        if (existing is null)
        {
            if (push.BaseVersion is not null && await HasTombstoneAsync(db, nameof(OrganizationImage), row.Id, cancellationToken))
                return new SyncPushResult(nameof(OrganizationImage), row.Id, SyncPushOutcome.ServerWins, Warning: "Deleted on the server.");

            await ValidationHelper.RequireMaxCountAsync(
                db.OrganizationImages.Where(i => i.OrganizationId == organizationId),
                AppConstraints.MaxImagesPerOrg, "images", cancellationToken);
            var image = new OrganizationImage
            {
                Id = row.Id,
                FileName = row.FileName,
                ContentType = row.ContentType,
                CreatedAt = row.CreatedAt,
                OrganizationId = organizationId,
            };
            db.OrganizationImages.Add(image);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(OrganizationImage), row.Id, SyncPushOutcome.Applied, NewVersion: image.Version);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(OrganizationImage), row.Id, SyncPushOutcome.ServerWins);

        existing.FileName = row.FileName;
        existing.ContentType = row.ContentType;
        await db.SaveChangesAsync(cancellationToken);
        return new SyncPushResult(nameof(OrganizationImage), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version);
    }

    private async Task<SyncPushResult> ProcessAudioPushAsync(
        PresentationContext db, string organizationId, SyncRowPush<SyncOrganizationAudioDto> push,
        CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(Permission.ManageOrganizationAudios);
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.FileName, AppConstraints.FileNameMaxLength, "FileName");

        var existing = await db.OrganizationAudios
            .FirstOrDefaultAsync(a => a.Id == row.Id && a.OrganizationId == organizationId, cancellationToken);

        if (existing is null)
        {
            if (push.BaseVersion is not null && await HasTombstoneAsync(db, nameof(OrganizationAudio), row.Id, cancellationToken))
                return new SyncPushResult(nameof(OrganizationAudio), row.Id, SyncPushOutcome.ServerWins, Warning: "Deleted on the server.");

            await ValidationHelper.RequireMaxCountAsync(
                db.OrganizationAudios.Where(a => a.OrganizationId == organizationId),
                AppConstraints.MaxAudioPerOrg, "audio files", cancellationToken);
            var audio = new OrganizationAudio
            {
                Id = row.Id,
                FileName = row.FileName,
                ContentType = row.ContentType,
                CreatedAt = row.CreatedAt,
                OrganizationId = organizationId,
            };
            db.OrganizationAudios.Add(audio);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(OrganizationAudio), row.Id, SyncPushOutcome.Applied, NewVersion: audio.Version);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(OrganizationAudio), row.Id, SyncPushOutcome.ServerWins);

        existing.FileName = row.FileName;
        existing.ContentType = row.ContentType;
        await db.SaveChangesAsync(cancellationToken);
        return new SyncPushResult(nameof(OrganizationAudio), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version);
    }

    private async Task<SyncPushResult> ProcessOverlayPushAsync(
        PresentationContext db, string organizationId, SyncRowPush<SyncOverlaySlideDto> push,
        CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(Permission.ManageOverlays);
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.Title, AppConstraints.OverlayTitleMaxLength, "Title");
        ValidationHelper.RequireMaxLength(row.Content, AppConstraints.OverlayContentMaxLength, "Content");

        var existing = await db.OverlaySlides
            .FirstOrDefaultAsync(o => o.Id == row.Id && o.OrganizationId == organizationId, cancellationToken);

        if (existing is null)
        {
            if (push.BaseVersion is not null && await HasTombstoneAsync(db, nameof(OverlaySlide), row.Id, cancellationToken))
                return new SyncPushResult(nameof(OverlaySlide), row.Id, SyncPushOutcome.ServerWins, Warning: "Deleted on the server.");

            await ValidationHelper.RequireMaxCountAsync(
                db.OverlaySlides.Where(o => o.OrganizationId == organizationId),
                AppConstraints.MaxOverlaysPerOrg, "overlays", cancellationToken);
            var overlay = new OverlaySlide
            {
                Id = row.Id,
                Title = row.Title,
                Content = row.Content,
                HasImage = row.HasImage,
                SortOrder = row.SortOrder,
                OrganizationId = organizationId,
            };
            db.OverlaySlides.Add(overlay);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(OverlaySlide), row.Id, SyncPushOutcome.Applied, NewVersion: overlay.Version);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(OverlaySlide), row.Id, SyncPushOutcome.ServerWins);

        existing.Title = row.Title;
        existing.Content = row.Content;
        existing.HasImage = row.HasImage;
        existing.SortOrder = row.SortOrder;
        await db.SaveChangesAsync(cancellationToken);
        return new SyncPushResult(nameof(OverlaySlide), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version);
    }

    private async Task<SyncPushResult> ProcessOrganizationSettingPushAsync(
        PresentationContext db, string organizationId, SyncRowPush<SyncOrganizationSettingDto> push,
        CallerContext caller, CancellationToken cancellationToken)
    {
        // Same gate as OrganizationSettingService.SetSettingAsync.
        caller.RequirePermission(Permission.ManageUsers);
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.Key, AppConstraints.SettingsKeyMaxLength, "Key");
        ValidationHelper.RequireMaxLength(row.Value, AppConstraints.SettingsValueMaxLength, "Value");

        // Settings are keyed rows: the key identifies the setting, ids are incidental. A pushed
        // key that already exists under another id updates that row and reports the remap.
        var existing = await db.OrganizationSettings
            .FirstOrDefaultAsync(s => s.OrganizationId == organizationId && s.Key == row.Key, cancellationToken);

        if (existing is null)
        {
            await ValidationHelper.RequireMaxCountAsync(
                db.OrganizationSettings.Where(s => s.OrganizationId == organizationId),
                AppConstraints.MaxSettingsPerOrg, "settings", cancellationToken);
            var setting = new OrganizationSetting
            {
                Id = row.Id,
                OrganizationId = organizationId,
                Key = row.Key,
                Value = row.Value,
            };
            db.OrganizationSettings.Add(setting);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(OrganizationSetting), row.Id, SyncPushOutcome.Applied, NewVersion: setting.Version);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(OrganizationSetting), row.Id, SyncPushOutcome.ServerWins);

        existing.Value = row.Value;
        await db.SaveChangesAsync(cancellationToken);
        return existing.Id == row.Id
            ? new SyncPushResult(nameof(OrganizationSetting), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version)
            : new SyncPushResult(nameof(OrganizationSetting), row.Id, SyncPushOutcome.Remapped, NewId: existing.Id, NewVersion: existing.Version);
    }

    private async Task<SyncPushResult> ProcessUserSettingPushAsync(
        PresentationContext db, SyncRowPush<SyncUserSettingDto> push, CallerContext caller,
        CancellationToken cancellationToken)
    {
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.Key, AppConstraints.SettingsKeyMaxLength, "Key");
        ValidationHelper.RequireMaxLength(row.Value, AppConstraints.SettingsValueMaxLength, "Value");

        var existing = await db.UserSettings
            .FirstOrDefaultAsync(s => s.UserId == caller.UserId && s.Key == row.Key, cancellationToken);

        if (existing is null)
        {
            await ValidationHelper.RequireMaxCountAsync(
                db.UserSettings.Where(s => s.UserId == caller.UserId),
                AppConstraints.MaxSettingsPerUser, "settings", cancellationToken);
            var setting = new UserSetting
            {
                Id = row.Id,
                UserId = caller.UserId,
                Key = row.Key,
                Value = row.Value,
            };
            db.UserSettings.Add(setting);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(UserSetting), row.Id, SyncPushOutcome.Applied, NewVersion: setting.Version);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(UserSetting), row.Id, SyncPushOutcome.ServerWins);

        existing.Value = row.Value;
        await db.SaveChangesAsync(cancellationToken);
        return existing.Id == row.Id
            ? new SyncPushResult(nameof(UserSetting), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version)
            : new SyncPushResult(nameof(UserSetting), row.Id, SyncPushOutcome.Remapped, NewId: existing.Id, NewVersion: existing.Version);
    }

    /// <summary>
    /// Rides on an Applied result, because the row did go in — just not under the code the device
    /// asked for. The device has to be told: it is the code its operator is about to print.
    /// </summary>
    private const string CodeReplacedWarning = "The output's code was already taken and has been replaced.";

    private async Task<SyncPushResult> ProcessRemoteDisplayPushAsync(
        PresentationContext db, string organizationId, SyncRowPush<SyncRemoteDisplayDto> push,
        CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        var row = push.Row;
        ValidationHelper.RequireMaxLength(row.Name, AppConstraints.NameMaxLength, "Name");

        var existing = await db.RemoteDisplays
            .FirstOrDefaultAsync(d => d.Id == row.Id && d.OrganizationId == organizationId, cancellationToken);

        if (existing is null)
        {
            if (push.BaseVersion is not null && await HasTombstoneAsync(db, nameof(RemoteDisplay), row.Id, cancellationToken))
                return new SyncPushResult(nameof(RemoteDisplay), row.Id, SyncPushOutcome.ServerWins, Warning: "Deleted on the server.");

            await ValidationHelper.RequireMaxCountAsync(
                db.RemoteDisplays.Where(d => d.OrganizationId == organizationId),
                AppConstraints.MaxRemoteDisplaysPerOrg, "outputs", cancellationToken);

            var display = new RemoteDisplay
            {
                Id = row.Id,
                OrganizationId = organizationId,
                DisplayIdentifier = await FreeIdentifierAsync(db, row.DisplayIdentifier, row.Id, cancellationToken),
                Name = row.Name,
                Kind = row.Kind,
                CreatedAt = row.CreatedAt,
            };
            db.RemoteDisplays.Add(display);
            await db.SaveChangesAsync(cancellationToken);
            return new SyncPushResult(nameof(RemoteDisplay), row.Id, SyncPushOutcome.Applied, NewVersion: display.Version,
                Warning: display.DisplayIdentifier == row.DisplayIdentifier
                    ? null
                    : CodeReplacedWarning);
        }

        if (push.BaseVersion != existing.Version)
            return new SyncPushResult(nameof(RemoteDisplay), row.Id, SyncPushOutcome.ServerWins);

        // The code travels too, and the version check above is what makes that safe. Regenerating is
        // the only remedy when a QR code has been shared where it does not belong, so a device that
        // can manage outputs at all has to be able to do it. The risk that argued against it — a
        // device offline since before someone else regenerated putting the old code back — is a
        // stale BaseVersion, and a stale BaseVersion has already returned ServerWins by here.
        existing.Name = row.Name;
        existing.DisplayIdentifier =
            await FreeIdentifierAsync(db, row.DisplayIdentifier, row.Id, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return new SyncPushResult(nameof(RemoteDisplay), row.Id, SyncPushOutcome.Applied, NewVersion: existing.Version,
            Warning: existing.DisplayIdentifier == row.DisplayIdentifier
                ? null
                : CodeReplacedWarning);
    }

    /// <summary>
    /// The pushed code if no other output holds it, otherwise a fresh one. Codes are unique across
    /// every organisation, and a device that created an output offline minted its own.
    /// </summary>
    private static async Task<string> FreeIdentifierAsync(
        PresentationContext db, string wanted, string ownId, CancellationToken cancellationToken)
    {
        var taken = await db.RemoteDisplays
            .AnyAsync(d => d.DisplayIdentifier == wanted && d.Id != ownId, cancellationToken);
        if (!taken)
            return wanted;

        for (var attempt = 0; attempt < DisplayIdentifiers.MaxRetries; attempt++)
        {
            var candidate = DisplayIdentifiers.Generate();
            if (!await db.RemoteDisplays.AnyAsync(d => d.DisplayIdentifier == candidate, cancellationToken))
                return candidate;
        }

        throw new InvalidOperationException("Failed to generate a unique display ID after multiple attempts.");
    }

    private async Task<SyncPushResult> ProcessDeleteAsync(
        PresentationContext db, string organizationId, SyncDeletePush delete, CallerContext caller,
        CancellationToken cancellationToken)
    {
        // An edit on the server beats an offline delete: on a base mismatch the delete is rejected
        // and the client re-learns the row on its next pull.
        switch (delete.EntityType)
        {
            case nameof(Presentation):
            {
                var presentation = await db.Presentations.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.Id == delete.Id && p.OrganizationId == organizationId, cancellationToken);
                if (presentation is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != presentation.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                if (presentation.IsTemplate)
                    await presentationService.DeleteTemplateAsync(organizationId, delete.Id, caller);
                else
                    await presentationService.DeletePresentationAsync(organizationId, delete.Id, caller);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(DbSong):
            {
                var song = await db.Songs.AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Id == delete.Id && s.OrganizationId == organizationId, cancellationToken);
                if (song is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != song.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);
                if (song.DeletedAt is null)
                {
                    // Trash first (an ordinary row update via the aggregate push), then delete.
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins,
                        Warning: "The song is not in the trash on the server.");
                }

                await songService.PermanentlyDeleteSongAsync(delete.Id, organizationId, caller);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(DbSongPartLabel):
            {
                var label = await db.SongPartLabels.AsNoTracking()
                    .FirstOrDefaultAsync(l => l.Id == delete.Id && l.OrganizationId == organizationId, cancellationToken);
                if (label is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != label.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                await songPartLabelService.DeleteLabelAsync(organizationId, delete.Id, caller);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(OverlaySlide):
            {
                var overlay = await db.OverlaySlides.AsNoTracking()
                    .FirstOrDefaultAsync(o => o.Id == delete.Id && o.OrganizationId == organizationId, cancellationToken);
                if (overlay is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != overlay.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                await presentationService.RemoveOverlayAsync(organizationId, delete.Id, caller);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(OrganizationImage):
            {
                var image = await db.OrganizationImages.AsNoTracking()
                    .FirstOrDefaultAsync(i => i.Id == delete.Id && i.OrganizationId == organizationId, cancellationToken);
                if (image is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != image.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                await organizationImageService.DeleteImageAsync(delete.Id, organizationId, caller);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(OrganizationAudio):
            {
                var audio = await db.OrganizationAudios.AsNoTracking()
                    .FirstOrDefaultAsync(a => a.Id == delete.Id && a.OrganizationId == organizationId, cancellationToken);
                if (audio is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != audio.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                await organizationAudioService.DeleteAudioAsync(delete.Id, organizationId, caller);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(UserSetting):
            {
                var setting = await db.UserSettings
                    .FirstOrDefaultAsync(s => s.Id == delete.Id && s.UserId == caller.UserId, cancellationToken);
                if (setting is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != setting.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                db.UserSettings.Remove(setting);
                await db.SaveChangesAsync(cancellationToken);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(RemoteDisplay):
            {
                caller.RequirePermission(Permission.ManageRemoteDisplays);
                var display = await db.RemoteDisplays
                    .FirstOrDefaultAsync(d => d.Id == delete.Id && d.OrganizationId == organizationId, cancellationToken);
                if (display is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != display.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                // Tracked, so the save writes the tombstone the other devices need.
                db.RemoteDisplays.Remove(display);
                await db.SaveChangesAsync(cancellationToken);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            case nameof(OrganizationSetting):
            {
                caller.RequirePermission(Permission.ManageUsers);
                var setting = await db.OrganizationSettings
                    .FirstOrDefaultAsync(s => s.Id == delete.Id && s.OrganizationId == organizationId, cancellationToken);
                if (setting is null)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
                if (delete.BaseVersion != setting.Version)
                    return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.ServerWins);

                db.OrganizationSettings.Remove(setting);
                await db.SaveChangesAsync(cancellationToken);
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Applied);
            }

            default:
                return new SyncPushResult(delete.EntityType, delete.Id, SyncPushOutcome.Failed,
                    Warning: $"Deletes of '{delete.EntityType}' are not part of the sync protocol.");
        }
    }

    private static void ValidateSong(SyncSongDto dto, List<SyncSongPartDto> parts, List<SyncSongArrangementDto> arrangements)
    {
        ValidationHelper.RequireMaxLength(dto.Name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(dto.Author, AppConstraints.SongAuthorMaxLength, "Author");
        ValidationHelper.RequireMaxLength(dto.Publisher, AppConstraints.SongPublisherMaxLength, "Publisher");
        ValidationHelper.RequireMaxLength(dto.Ccli, AppConstraints.SongCcliMaxLength, "CCLI");
        ValidationHelper.RequireRange(dto.Year, AppConstraints.SongYearMin, AppConstraints.SongYearMax, "Year");
        if (parts.Count > AppConstraints.MaxSongPartsPerSong)
            throw new InvalidOperationException($"The maximum number of song parts ({AppConstraints.MaxSongPartsPerSong}) has been reached.");
        if (arrangements.Count > AppConstraints.MaxArrangementsPerSong)
            throw new InvalidOperationException($"The maximum number of arrangements ({AppConstraints.MaxArrangementsPerSong}) has been reached.");
        foreach (var part in parts)
            ValidationHelper.RequireMaxLength(part.Content, AppConstraints.SongPartContentMaxLength, "Content");
        foreach (var arrangement in arrangements)
        {
            ValidationHelper.RequireMaxLength(arrangement.Name, AppConstraints.SongArrangementNameMaxLength, "Name");
            ValidationHelper.RequireMaxLength(arrangement.PartIdsJson, AppConstraints.SongArrangementPartIdsJsonMaxLength, "PartIdsJson");
        }
    }

    private static void ValidatePresentation(SyncPresentationDto dto, List<SyncPresentationItemDto> items, List<SyncPresentationItemPartDto> parts)
    {
        ValidationHelper.RequireMaxLength(dto.Name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(dto.Description, AppConstraints.DescriptionMaxLength, "Description");
        ValidationHelper.RequireMaxLength(dto.EventLocation, AppConstraints.LocationMaxLength, "Location");
        if (items.Count > AppConstraints.MaxItemsPerPresentation)
            throw new InvalidOperationException($"The maximum number of items ({AppConstraints.MaxItemsPerPresentation}) has been reached.");
        foreach (var item in items)
            ValidationHelper.RequireMaxLength(item.Title, AppConstraints.NameMaxLength, "Title");
        var partsPerItem = parts.GroupBy(p => p.PresentationItemId);
        foreach (var group in partsPerItem)
        {
            if (group.Count() > AppConstraints.MaxPartsPerPresentationItem)
                throw new InvalidOperationException($"The maximum number of parts ({AppConstraints.MaxPartsPerPresentationItem}) has been reached.");
        }
        foreach (var part in parts)
            ValidationHelper.RequireMaxLength(part.Content, AppConstraints.PresentationItemPartContentMaxLength, "Content");
    }

    private static async Task RequirePresentationCapacityAsync(
        PresentationContext db, string organizationId, bool isTemplate, CancellationToken cancellationToken)
    {
        if (isTemplate)
            await ValidationHelper.RequireMaxCountAsync(
                db.Presentations.Where(p => p.OrganizationId == organizationId && p.IsTemplate),
                AppConstraints.MaxTemplatesPerOrg, "templates", cancellationToken);
        else
            await ValidationHelper.RequireMaxCountAsync(
                db.Presentations.Where(p => p.OrganizationId == organizationId && !p.IsTemplate),
                AppConstraints.MaxPresentationsPerOrg, "presentations", cancellationToken);
    }

    /// <summary>Same rule as UpdatePresentationThemeAsync: a theme id from a client is only trusted if the organisation may use it.</summary>
    private static async Task<string?> ResolveThemeIdAsync(
        PresentationContext db, string organizationId, string? themeId, List<string> warnings,
        CancellationToken cancellationToken)
    {
        if (themeId is null) return null;
        var usable = await db.Themes
            .AnyAsync(t => t.Id == themeId && (t.OrganizationId == null || t.OrganizationId == organizationId), cancellationToken);
        if (usable) return themeId;
        warnings.Add($"Theme '{themeId}' is not available; the presentation follows the organisation default.");
        return null;
    }

    /// <summary>A pushed label reference is kept only if it can actually be satisfied; the label FK would otherwise reject the whole save.</summary>
    private static string? ResolveLabelId(string? labelId, Dictionary<string, string> labelRemap, HashSet<string> validLabelIds)
    {
        if (labelId is null) return null;
        var resolved = labelRemap.GetValueOrDefault(labelId, labelId);
        return validLabelIds.Contains(resolved) ? resolved : null;
    }

    /// <summary>Preserves a conflict-losing pushed song state in the song's version history.</summary>
    private static async Task AppendConflictVersionAsync(
        PresentationContext db, string songId, SyncSongDto dto, List<SyncSongPartDto> parts,
        CancellationToken cancellationToken)
    {
        var labelIds = parts.Where(p => p.LabelId is not null).Select(p => p.LabelId!).Distinct().ToList();
        var labels = await db.SongPartLabels
            .Where(l => labelIds.Contains(l.Id))
            .ToDictionaryAsync(l => l.Id, cancellationToken);

        var snapshot = parts
            .OrderBy(p => p.SortOrder)
            .Select(p =>
            {
                var label = p.LabelId is not null ? labels.GetValueOrDefault(p.LabelId) : null;
                return new State.SongPart(p.Id, p.LabelId, label?.Text, label?.Color, p.Content);
            })
            .ToList();

        db.SongVersions.Add(new DbSongVersion
        {
            SongId = songId,
            Name = dto.Name,
            Author = dto.Author,
            PartsJson = JsonSerializer.Serialize(snapshot),
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    private static Task<bool> HasTombstoneAsync(PresentationContext db, string entityType, string entityId, CancellationToken cancellationToken) =>
        db.SyncTombstones.AnyAsync(t => t.EntityType == entityType && t.EntityId == entityId, cancellationToken);

    private static string? JoinWarnings(List<string> warnings) =>
        warnings.Count == 0 ? null : string.Join(" ", warnings);

    private static string EncodeCursor(PullCursor cursor) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(cursor)));

    private static PullCursor? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrEmpty(cursor)) return null;
        try
        {
            return JsonSerializer.Deserialize<PullCursor>(Encoding.UTF8.GetString(Convert.FromBase64String(cursor)));
        }
        catch (Exception e) when (e is FormatException or JsonException)
        {
            throw new ArgumentException("Invalid sync cursor.", nameof(cursor));
        }
    }
}
