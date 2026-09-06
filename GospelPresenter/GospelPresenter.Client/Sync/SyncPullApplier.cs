using System.Text.Json;
using System.Text.Json.Serialization;
using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Sync;

/// <summary>Everything one pull produced, merged across its pages, plus the watermark to store.</summary>
internal sealed record PullBatch(
    SyncChanges Changes,
    List<SyncTombstoneDto> Tombstones,
    /// <summary>Null when this is not a pull: healing a conflict applies server rows without
    /// moving the watermark, because no window of server time has been covered.</summary>
    DateTimeOffset? ServerWatermark,
    bool RequiresFullResync);

internal sealed record PullApplyResult(int AppliedRows, bool SongsChanged, bool BiblesChanged);

/// <summary>
/// Writes one pull into the local database, atomically: server rows are upserted in dependency
/// order, tombstones deleted last (cascades and SET NULL run in the database, mirroring the
/// server's), the conflict bases updated and the new watermark stored — all in one transaction,
/// with SyncState['applying'] set so the journal triggers stay silent and EF's sync stamping
/// suppressed so rows keep the server's ModifiedAt.
///
/// Rows whose aggregate root has pending journal entries (edited while the push was in flight)
/// are skipped, base included: overwriting them would lose the local edit, and their stale base
/// makes the next push resolve the conflict server-side. Tombstones are NOT skipped — a deletion
/// on the server always wins.
/// </summary>
internal class SyncPullApplier(ClientDataContext db, DeviceIdentity? identity, ILogger logger)
{
    private static readonly JsonSerializerOptions ThemeJsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly List<(string Table, string Id, long Version)> baseUpdates = [];
    private int appliedRows;

    public async Task<PullApplyResult> ApplyAsync(PullBatch batch, CancellationToken ct)
    {
        db.ApplyingServerChanges = true;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await SyncSql.SetStateAsync(db, SyncStateEntry.ApplyingKey, "1", ct);

            await EnsureIdentityRowsAsync(ct);
            var dirty = await GetDirtyRootsAsync(ct);
            var changes = batch.Changes;

            // Referenced rows before referencing ones; EF also orders the inserts of one save by
            // their foreign keys, so a theme and the presentation pointing at it can share a save.
            var validLabelIds = await ValidIdsAsync(db.SongPartLabels.Select(l => l.Id), changes.SongPartLabels, ct);
            var validThemeIds = await ValidIdsAsync(db.Themes.Select(t => t.Id), changes.Themes, ct);

            await ApplyLabelsAsync(changes.SongPartLabels, dirty, ct);
            await ApplyThemesAsync(changes.Themes, ct);
            await ApplySongsAsync(changes.Songs, dirty, ct);
            await ApplySongPartsAsync(changes.SongParts, dirty, validLabelIds, ct);
            await ApplySongArrangementsAsync(changes.SongArrangements, dirty, ct);
            await ApplySongVersionsAsync(changes.SongVersions, ct);
            await ApplyBiblesAsync(changes.Bibles, ct);
            await ApplyPresentationsAsync(changes.Presentations, dirty, validThemeIds, ct);
            await ApplyPresentationItemsAsync(changes.PresentationItems, dirty, ct);
            await ApplyPresentationItemPartsAsync(changes.PresentationItemParts, changes.PresentationItems, dirty, ct);
            await ApplyPresentationSlidesAsync(changes.PresentationSlides, dirty, ct);
            await ApplyOverlaysAsync(changes.OverlaySlides, dirty, ct);
            await ApplyImagesAsync(changes.OrganizationImages, dirty, ct);
            await ApplyAudiosAsync(changes.OrganizationAudios, dirty, ct);
            await ApplyOrganizationSettingsAsync(changes.OrganizationSettings, dirty, ct);
            await ApplyUserSettingsAsync(changes.UserSettings, dirty, ct);
            await ApplyRemoteDisplaysAsync(changes.RemoteDisplays, dirty, ct);

            await db.SaveChangesAsync(ct);

            foreach (var (table, id, version) in baseUpdates)
                await SyncSql.UpsertBaseAsync(db, table, id, version, ct);

            var (tombstonedSongs, tombstonedBibles) = await ApplyTombstonesAsync(batch.Tombstones, ct);

            if (batch.ServerWatermark is { } watermark)
                await SyncSql.SetStateAsync(db, SyncStateEntry.WatermarkKey, watermark.ToString("O"), ct);
            await SyncSql.SetStateAsync(db, SyncStateEntry.ApplyingKey, "0", ct);
            await transaction.CommitAsync(ct);

            var songsChanged = tombstonedSongs
                               || changes.SongPartLabels.Count > 0 || changes.Songs.Count > 0
                               || changes.SongParts.Count > 0 || changes.SongArrangements.Count > 0
                               || changes.SongVersions.Count > 0;
            var biblesChanged = tombstonedBibles || changes.Bibles.Count > 0;
            return new PullApplyResult(appliedRows, songsChanged, biblesChanged);
        }
        finally
        {
            db.ApplyingServerChanges = false;
        }
    }

    /// <summary>
    /// Users and organisations are not part of the sync protocol, but the synced rows have foreign
    /// keys to them — the cached device identity provides the two rows everything hangs from.
    /// Shared with the sign-in path, which writes the same rows before the first pull exists.
    /// </summary>
    private async Task EnsureIdentityRowsAsync(CancellationToken ct)
    {
        if (identity is null)
            return;

        await DeviceIdentityRows.UpsertAsync(db, identity, ct);
    }

    private async Task<HashSet<RootRef>> GetDirtyRootsAsync(CancellationToken ct)
    {
        var journal = await db.SyncJournal.AsNoTracking().ToListAsync(ct);
        if (journal.Count == 0)
            return [];
        return await SyncTables.ResolveRootsAsync(journal, ids =>
            db.PresentationItems.AsNoTracking()
                .Where(i => ids.Contains(i.Id))
                .Select(i => new { i.Id, i.PresentationId })
                .ToDictionaryAsync(x => x.Id, x => x.PresentationId, ct));
    }

    /// <summary>Local ids plus the incoming batch — what a foreign key may point at after this apply.</summary>
    private static async Task<HashSet<string>> ValidIdsAsync<TDto>(
        IQueryable<string> localIds, List<TDto> incoming, CancellationToken ct) where TDto : ISyncRow
    {
        var ids = (await localIds.ToListAsync(ct)).ToHashSet();
        foreach (var row in incoming)
            ids.Add(row.Id);
        return ids;
    }

    /// <summary>Deduplicates overlap-window re-serves: the last occurrence of an id is the newest.</summary>
    private static List<TDto> Latest<TDto>(List<TDto> rows) where TDto : ISyncRow
    {
        if (rows.Count == 0) return rows;
        var byId = new Dictionary<string, TDto>();
        foreach (var row in rows)
            byId[row.Id] = row;
        return byId.Values.ToList();
    }

    /// <summary>
    /// The shared upsert: skip rows whose root is dirty, update existing rows, add the rest.
    /// Returns the applied rows so callers can record conflict bases.
    /// </summary>
    private async Task<List<TDto>> UpsertAsync<TEntity, TDto>(
        DbSet<TEntity> set, List<TDto> rows, HashSet<RootRef> dirty, Func<TDto, RootRef?> rootOf,
        Func<TEntity, string> idOf, Func<TDto, TEntity> create, Action<TDto, TEntity> update,
        CancellationToken ct)
        where TEntity : class
        where TDto : ISyncRow
    {
        var incoming = Latest(rows)
            .Where(r => rootOf(r) is not { } root || !dirty.Contains(root))
            .ToList();
        if (incoming.Count == 0)
            return incoming;

        var ids = incoming.Select(r => r.Id).ToList();
        var existing = (await set.Where(e => ids.Contains(EF.Property<string>(e, "Id"))).ToListAsync(ct))
            .ToDictionary(idOf);

        foreach (var dto in incoming)
        {
            if (existing.TryGetValue(dto.Id, out var entity))
                update(dto, entity);
            else
                set.Add(create(dto));
        }

        appliedRows += incoming.Count;
        return incoming;
    }

    private void RecordBases<TDto>(string table, List<TDto> applied) where TDto : ISyncRootRow
    {
        foreach (var dto in applied)
            baseUpdates.Add((table, dto.Id, dto.Version));
    }

    private async Task ApplyLabelsAsync(List<SyncSongPartLabelDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        // Label text is unique per organisation. An incoming label whose text collides with a
        // local label under another id can only mean an offline-created local label the push has
        // not resolved yet — skip the incoming row; the push's Remapped outcome cleans this up.
        var incoming = Latest(rows);
        if (incoming.Count == 0) return;
        var ids = incoming.Select(r => r.Id).ToList();
        var texts = incoming.Select(r => r.Text).ToList();
        var clashes = (await db.SongPartLabels
                .Where(l => texts.Contains(l.Text) && !ids.Contains(l.Id))
                .Select(l => l.Text)
                .ToListAsync(ct))
            .ToHashSet();

        var applied = await UpsertAsync(db.SongPartLabels,
            incoming.Where(r => !clashes.Contains(r.Text)).ToList(), dirty,
            r => new RootRef("SongPartLabels", r.Id),
            l => l.Id,
            r => new DbSongPartLabel
            {
                Id = r.Id, Text = r.Text, Color = r.Color, SortOrder = r.SortOrder,
                OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, l) =>
            {
                l.Text = r.Text;
                l.Color = r.Color;
                l.SortOrder = r.SortOrder;
                l.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("SongPartLabels", applied);
    }

    private async Task ApplyThemesAsync(List<SyncThemeDto> rows, CancellationToken ct)
    {
        await UpsertAsync(db.Themes, rows, [], _ => null,
            t => t.Id,
            r => new Theme
            {
                Id = r.Id, OrganizationId = r.OrganizationId, Name = r.Name, SortOrder = r.SortOrder,
                Definition = ParseTheme(r.DefinitionJson), ModifiedAt = r.ModifiedAt,
            },
            (r, t) =>
            {
                t.OrganizationId = r.OrganizationId;
                t.Name = r.Name;
                t.SortOrder = r.SortOrder;
                t.Definition = ParseTheme(r.DefinitionJson);
                t.ModifiedAt = r.ModifiedAt;
            }, ct);
    }

    private SlideTheme ParseTheme(string definitionJson)
    {
        try
        {
            return JsonSerializer.Deserialize<SlideTheme>(definitionJson, ThemeJsonOptions) ?? new SlideTheme();
        }
        catch (JsonException e)
        {
            logger.LogWarning(e, "A pulled theme definition did not parse; the theme falls back to defaults");
            return new SlideTheme();
        }
    }

    private async Task ApplySongsAsync(List<SyncSongDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.Songs, rows, dirty,
            r => new RootRef("Songs", r.Id),
            s => s.Id,
            r => new DbSong
            {
                Id = r.Id, Name = r.Name, Author = r.Author, Publisher = r.Publisher, Year = r.Year,
                Ccli = r.Ccli, DeletedAt = r.DeletedAt, OrganizationId = identity?.OrganizationId ?? "",
                ModifiedAt = r.ModifiedAt,
            },
            (r, s) =>
            {
                s.Name = r.Name;
                s.Author = r.Author;
                s.Publisher = r.Publisher;
                s.Year = r.Year;
                s.Ccli = r.Ccli;
                s.DeletedAt = r.DeletedAt;
                s.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("Songs", applied);
    }

    private Task ApplySongPartsAsync(
        List<SyncSongPartDto> rows, HashSet<RootRef> dirty, HashSet<string> validLabelIds, CancellationToken ct) =>
        UpsertAsync(db.SongParts, rows, dirty,
            r => new RootRef("Songs", r.SongId),
            p => p.Id,
            r => new DbSongPart
            {
                Id = r.Id, LabelId = ValidOrNull(r.LabelId, validLabelIds), Content = r.Content,
                SortOrder = r.SortOrder, SongId = r.SongId, ModifiedAt = r.ModifiedAt,
            },
            (r, p) =>
            {
                p.LabelId = ValidOrNull(r.LabelId, validLabelIds);
                p.Content = r.Content;
                p.SortOrder = r.SortOrder;
                p.SongId = r.SongId;
                p.ModifiedAt = r.ModifiedAt;
            }, ct);

    private static string? ValidOrNull(string? id, HashSet<string> validIds) =>
        id is not null && validIds.Contains(id) ? id : null;

    private Task ApplySongArrangementsAsync(List<SyncSongArrangementDto> rows, HashSet<RootRef> dirty, CancellationToken ct) =>
        UpsertAsync(db.SongArrangements, rows, dirty,
            r => new RootRef("Songs", r.SongId),
            a => a.Id,
            r => new DbSongArrangement
            {
                Id = r.Id, Name = r.Name, PartIdsJson = r.PartIdsJson, SongId = r.SongId, ModifiedAt = r.ModifiedAt,
            },
            (r, a) =>
            {
                a.Name = r.Name;
                a.PartIdsJson = r.PartIdsJson;
                a.SongId = r.SongId;
                a.ModifiedAt = r.ModifiedAt;
            }, ct);

    private Task ApplySongVersionsAsync(List<SyncSongVersionDto> rows, CancellationToken ct) =>
        UpsertAsync(db.SongVersions, rows, [], _ => null,
            v => v.Id,
            r => new DbSongVersion
            {
                Id = r.Id, SongId = r.SongId, CreatedAt = r.CreatedAt, Name = r.Name, Author = r.Author,
                PartsJson = r.PartsJson, ModifiedAt = r.ModifiedAt,
            },
            (r, v) =>
            {
                v.Name = r.Name;
                v.Author = r.Author;
                v.PartsJson = r.PartsJson;
                v.ModifiedAt = r.ModifiedAt;
            }, ct);

    private async Task ApplyBiblesAsync(List<SyncBibleDto> rows, CancellationToken ct)
    {
        // Abbreviations are unique per organisation. An incoming Bible whose abbreviation exists
        // locally under another id is an import made on this device; the local copy stands, since
        // Bibles have no upstream sync path that could reconcile them.
        var incoming = Latest(rows);
        if (incoming.Count == 0) return;
        var ids = incoming.Select(r => r.Id).ToList();
        var abbreviations = incoming.Select(r => r.Abbreviation).ToList();
        var clashes = (await db.Bibles
                .Where(b => abbreviations.Contains(b.Abbreviation) && !ids.Contains(b.Id))
                .Select(b => b.Abbreviation)
                .ToListAsync(ct))
            .ToHashSet();

        // Metadata only — VersesJson is downloaded separately per pinned translation, and an
        // update must not clobber a downloaded copy.
        await UpsertAsync(db.Bibles, incoming.Where(r => !clashes.Contains(r.Abbreviation)).ToList(), [], _ => null,
            b => b.Id,
            r => new DbBible
            {
                Id = r.Id, Name = r.Name, Abbreviation = r.Abbreviation, VerseCount = r.VerseCount,
                OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, b) =>
            {
                b.Name = r.Name;
                b.Abbreviation = r.Abbreviation;
                b.VerseCount = r.VerseCount;
                b.ModifiedAt = r.ModifiedAt;
            }, ct);
    }

    private async Task ApplyPresentationsAsync(
        List<SyncPresentationDto> rows, HashSet<RootRef> dirty, HashSet<string> validThemeIds, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.Presentations, rows, dirty,
            r => new RootRef("Presentations", r.Id),
            p => p.Id,
            r => new Presentation
            {
                Id = r.Id, Name = r.Name, CreatedAt = r.CreatedAt, CreatedBy = r.CreatedBy,
                UpdatedAt = r.UpdatedAt, UpdatedBy = r.UpdatedBy, IsTemplate = r.IsTemplate,
                Description = r.Description, LastUsedAt = r.LastUsedAt, UseCount = r.UseCount,
                ScheduledDayOfWeek = r.ScheduledDayOfWeek, ScheduledTime = r.ScheduledTime,
                EventDate = r.EventDate, EventTime = r.EventTime, EventLocation = r.EventLocation,
                ThemeId = ValidOrNull(r.ThemeId, validThemeIds), DeletedAt = r.DeletedAt,
                OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, p) =>
            {
                p.Name = r.Name;
                p.CreatedAt = r.CreatedAt;
                p.CreatedBy = r.CreatedBy;
                p.UpdatedAt = r.UpdatedAt;
                p.UpdatedBy = r.UpdatedBy;
                p.IsTemplate = r.IsTemplate;
                p.Description = r.Description;
                p.LastUsedAt = r.LastUsedAt;
                p.UseCount = r.UseCount;
                p.ScheduledDayOfWeek = r.ScheduledDayOfWeek;
                p.ScheduledTime = r.ScheduledTime;
                p.EventDate = r.EventDate;
                p.EventTime = r.EventTime;
                p.EventLocation = r.EventLocation;
                p.ThemeId = ValidOrNull(r.ThemeId, validThemeIds);
                p.DeletedAt = r.DeletedAt;
                p.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("Presentations", applied);
    }

    private Task ApplyPresentationItemsAsync(List<SyncPresentationItemDto> rows, HashSet<RootRef> dirty, CancellationToken ct) =>
        UpsertAsync(db.PresentationItems, rows, dirty,
            r => new RootRef("Presentations", r.PresentationId),
            i => i.Id,
            r => new PresentationItem
            {
                Id = r.Id, SourceId = r.SourceId, Type = r.Type, Title = r.Title,
                ArrangementId = r.ArrangementId, SortOrder = r.SortOrder, PresentationId = r.PresentationId,
                ModifiedAt = r.ModifiedAt,
            },
            (r, i) =>
            {
                i.SourceId = r.SourceId;
                i.Type = r.Type;
                i.Title = r.Title;
                i.ArrangementId = r.ArrangementId;
                i.SortOrder = r.SortOrder;
                i.PresentationId = r.PresentationId;
                i.ModifiedAt = r.ModifiedAt;
            }, ct);

    private async Task ApplyPresentationItemPartsAsync(
        List<SyncPresentationItemPartDto> rows, List<SyncPresentationItemDto> incomingItems,
        HashSet<RootRef> dirty, CancellationToken ct)
    {
        // A part resolves to its presentation through its item: found in the same batch, or
        // locally when only the part changed. An unresolvable part is skipped defensively — its
        // item is unknown, so the insert could only fail.
        var itemToPresentation = new Dictionary<string, string>();
        foreach (var item in incomingItems)
            itemToPresentation[item.Id] = item.PresentationId;

        var missingItemIds = rows
            .Select(r => r.PresentationItemId)
            .Where(id => !itemToPresentation.ContainsKey(id))
            .Distinct()
            .ToList();
        if (missingItemIds.Count > 0)
        {
            var local = await db.PresentationItems.AsNoTracking()
                .Where(i => missingItemIds.Contains(i.Id))
                .Select(i => new { i.Id, i.PresentationId })
                .ToListAsync(ct);
            foreach (var item in local)
                itemToPresentation[item.Id] = item.PresentationId;
        }

        await UpsertAsync(db.PresentationItemParts,
            rows.Where(r => itemToPresentation.ContainsKey(r.PresentationItemId)).ToList(), dirty,
            r => new RootRef("Presentations", itemToPresentation[r.PresentationItemId]),
            p => p.Id,
            r => new PresentationItemPart
            {
                Id = r.Id, Content = r.Content, SortOrder = r.SortOrder,
                PresentationItemId = r.PresentationItemId, ModifiedAt = r.ModifiedAt,
            },
            (r, p) =>
            {
                p.Content = r.Content;
                p.SortOrder = r.SortOrder;
                p.PresentationItemId = r.PresentationItemId;
                p.ModifiedAt = r.ModifiedAt;
            }, ct);
    }

    private Task ApplyPresentationSlidesAsync(List<SyncPresentationSlidesDto> rows, HashSet<RootRef> dirty, CancellationToken ct) =>
        UpsertAsync(db.PresentationSlides, rows, dirty,
            r => new RootRef("Presentations", r.PresentationId),
            s => s.Id,
            r => new PresentationSlides
            {
                Id = r.Id, FileName = r.FileName, PageCount = r.PageCount, CreatedAt = r.CreatedAt,
                PresentationId = r.PresentationId, ModifiedAt = r.ModifiedAt,
            },
            (r, s) =>
            {
                s.FileName = r.FileName;
                s.PageCount = r.PageCount;
                s.CreatedAt = r.CreatedAt;
                s.PresentationId = r.PresentationId;
                s.ModifiedAt = r.ModifiedAt;
            }, ct);

    private async Task ApplyOverlaysAsync(List<SyncOverlaySlideDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.OverlaySlides, rows, dirty,
            r => new RootRef("OverlaySlides", r.Id),
            o => o.Id,
            r => new OverlaySlide
            {
                Id = r.Id, Title = r.Title, Content = r.Content, HasImage = r.HasImage,
                SortOrder = r.SortOrder, OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, o) =>
            {
                o.Title = r.Title;
                o.Content = r.Content;
                o.HasImage = r.HasImage;
                o.SortOrder = r.SortOrder;
                o.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("OverlaySlides", applied);
    }

    private async Task ApplyImagesAsync(List<SyncOrganizationImageDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.OrganizationImages, rows, dirty,
            r => new RootRef("OrganizationImages", r.Id),
            i => i.Id,
            r => new OrganizationImage
            {
                Id = r.Id, FileName = r.FileName, ContentType = r.ContentType, CreatedAt = r.CreatedAt,
                DeletedAt = r.DeletedAt,
                OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, i) =>
            {
                i.FileName = r.FileName;
                i.ContentType = r.ContentType;
                i.CreatedAt = r.CreatedAt;
                i.DeletedAt = r.DeletedAt;
                i.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("OrganizationImages", applied);
    }

    private async Task ApplyAudiosAsync(List<SyncOrganizationAudioDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.OrganizationAudios, rows, dirty,
            r => new RootRef("OrganizationAudios", r.Id),
            a => a.Id,
            r => new OrganizationAudio
            {
                Id = r.Id, FileName = r.FileName, ContentType = r.ContentType, CreatedAt = r.CreatedAt,
                DeletedAt = r.DeletedAt,
                OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, a) =>
            {
                a.FileName = r.FileName;
                a.ContentType = r.ContentType;
                a.CreatedAt = r.CreatedAt;
                a.DeletedAt = r.DeletedAt;
                a.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("OrganizationAudios", applied);
    }

    private async Task ApplyOrganizationSettingsAsync(List<SyncOrganizationSettingDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.OrganizationSettings,
            await WithoutKeyClashesAsync(db.OrganizationSettings.Select(s => new KeyRow(s.Id, s.Key)), rows, r => r.Key, ct),
            dirty,
            r => new RootRef("OrganizationSettings", r.Id),
            s => s.Id,
            r => new OrganizationSetting
            {
                Id = r.Id, Key = r.Key, Value = r.Value,
                OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, s) =>
            {
                s.Key = r.Key;
                s.Value = r.Value;
                s.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("OrganizationSettings", applied);
    }

    private async Task ApplyUserSettingsAsync(List<SyncUserSettingDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        var applied = await UpsertAsync(db.UserSettings,
            await WithoutKeyClashesAsync(db.UserSettings.Select(s => new KeyRow(s.Id, s.Key)), rows, r => r.Key, ct),
            dirty,
            r => new RootRef("UserSettings", r.Id),
            s => s.Id,
            r => new UserSetting
            {
                Id = r.Id, Key = r.Key, Value = r.Value,
                UserId = identity?.UserId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, s) =>
            {
                s.Key = r.Key;
                s.Value = r.Value;
                s.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("UserSettings", applied);
    }

    private sealed record KeyRow(string Id, string Key);

    /// <summary>
    /// Settings are unique per key. An incoming row whose key exists locally under another id can
    /// only be an offline-created local setting the push has not remapped yet — skip it this pull.
    /// </summary>
    private static async Task<List<TDto>> WithoutKeyClashesAsync<TDto>(
        IQueryable<KeyRow> localKeys, List<TDto> rows, Func<TDto, string> keyOf, CancellationToken ct)
        where TDto : ISyncRow
    {
        if (rows.Count == 0) return rows;
        var localIdByKey = new Dictionary<string, string>();
        foreach (var local in await localKeys.ToListAsync(ct))
            localIdByKey[local.Key] = local.Id;

        return rows
            .Where(r => !localIdByKey.TryGetValue(keyOf(r), out var localId) || localId == r.Id)
            .ToList();
    }

    private async Task ApplyRemoteDisplaysAsync(List<SyncRemoteDisplayDto> rows, HashSet<RootRef> dirty, CancellationToken ct)
    {
        // The code is unique across every organisation, so an incoming row can collide with a local
        // output created offline whose code the server has not yet replaced. Skipping it converges:
        // the local row's push earns a fresh code, and the next pull has nothing left to clash with.
        var applied = await UpsertAsync(db.RemoteDisplays,
            await WithoutKeyClashesAsync(
                db.RemoteDisplays.Select(d => new KeyRow(d.Id, d.DisplayIdentifier)), rows, r => r.DisplayIdentifier, ct),
            dirty,
            r => new RootRef("RemoteDisplays", r.Id),
            d => d.Id,
            r => new RemoteDisplay
            {
                Id = r.Id, DisplayIdentifier = r.DisplayIdentifier, Name = r.Name, Kind = r.Kind,
                CreatedAt = r.CreatedAt, OrganizationId = identity?.OrganizationId ?? "", ModifiedAt = r.ModifiedAt,
            },
            (r, d) =>
            {
                // The code included: the server may have replaced one this device invented offline,
                // and the QR codes it prints have to be the ones /watch resolves.
                d.DisplayIdentifier = r.DisplayIdentifier;
                d.Name = r.Name;
                d.Kind = r.Kind;
                d.CreatedAt = r.CreatedAt;
                d.ModifiedAt = r.ModifiedAt;
            }, ct);
        RecordBases("RemoteDisplays", applied);
    }

    private async Task<(bool SongsChanged, bool BiblesChanged)> ApplyTombstonesAsync(
        List<SyncTombstoneDto> tombstones, CancellationToken ct)
    {
        var songsChanged = false;
        var biblesChanged = false;
        foreach (var tombstone in tombstones)
        {
            var table = SyncTables.TableForEntityType(tombstone.EntityType);
            if (table is null)
                continue;

            // Table names come from our own map, never from the wire. Cascades and SET NULL run
            // in SQLite exactly as the server's Postgres ran them for the original delete.
#pragma warning disable EF1002
            var deleted = await db.Database.ExecuteSqlRawAsync(
                $"DELETE FROM \"{table}\" WHERE Id = {{0}}", [tombstone.EntityId], ct);
#pragma warning restore EF1002
            await SyncSql.RemoveBaseAsync(db, table, tombstone.EntityId, ct);

            if (deleted > 0)
            {
                appliedRows += deleted;
                songsChanged |= table is "Songs" or "SongParts" or "SongArrangements" or "SongPartLabels" or "SongVersions";
                biblesChanged |= table is "Bibles";
            }
        }

        return (songsChanged, biblesChanged);
    }
}
