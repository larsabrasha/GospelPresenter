using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Turns the change journal into a push request: journal rows are coalesced per aggregate root,
/// and the CURRENT local state of each touched root is sent — the journal only says what to push,
/// never what the content is. A root that no longer exists locally but has a delete journal entry
/// becomes a delete push. Every unit carries its conflict base from SyncBase (null for rows the
/// server has never acknowledged).
/// </summary>
internal static class SyncPushBuilder
{
    /// <summary>Null when the journal resolves to nothing pushable.</summary>
    public static async Task<SyncPushRequest?> BuildAsync(
        ClientDataContext db, IReadOnlyList<SyncJournalEntry> entries, string? deviceName,
        CancellationToken ct)
    {
        var roots = await SyncTables.ResolveRootsAsync(entries, ids =>
            db.PresentationItems.AsNoTracking()
                .Where(i => ids.Contains(i.Id))
                .Select(i => new { i.Id, i.PresentationId })
                .ToDictionaryAsync(x => x.Id, x => x.PresentationId, ct));
        if (roots.Count == 0)
            return null;

        var deletedRoots = entries
            .Where(e => e.Op == "D" && SyncTables.RootTables.Contains(e.EntityTable))
            .Select(e => new RootRef(e.EntityTable, e.RowId))
            .ToHashSet();

        var bases = await LoadBasesAsync(db, roots, ct);
        DateTimeOffset? Base(string table, string id) =>
            bases.TryGetValue(new RootRef(table, id), out var value) ? value : null;

        var request = new SyncPushRequest { DeviceName = deviceName };
        var pushedIds = new HashSet<RootRef>();

        List<string> IdsFor(string table) => roots.Where(r => r.Table == table).Select(r => r.Id).ToList();

        // Labels
        var labelIds = IdsFor("SongPartLabels");
        foreach (var l in await db.SongPartLabels.AsNoTracking().Where(l => labelIds.Contains(l.Id)).ToListAsync(ct))
        {
            request.SongPartLabels.Add(new SyncRowPush<SyncSongPartLabelDto>(
                new SyncSongPartLabelDto(l.Id, l.Text, l.Color, l.SortOrder, l.ModifiedAt),
                Base("SongPartLabels", l.Id)));
            pushedIds.Add(new RootRef("SongPartLabels", l.Id));
        }

        // Songs, as whole aggregates
        var songIds = IdsFor("Songs");
        var songs = await db.Songs.AsNoTracking()
            .Include(s => s.Parts)
            .Include(s => s.Arrangements)
            .Where(s => songIds.Contains(s.Id))
            .ToListAsync(ct);
        foreach (var s in songs)
        {
            request.Songs.Add(new SyncSongPush(
                new SyncSongDto(s.Id, s.Name, s.Author, s.Publisher, s.Year, s.Ccli, s.DeletedAt, s.ModifiedAt),
                s.Parts.OrderBy(p => p.SortOrder)
                    .Select(p => new SyncSongPartDto(p.Id, p.LabelId, p.Content, p.SortOrder, p.SongId, p.ModifiedAt))
                    .ToList(),
                s.Arrangements
                    .Select(a => new SyncSongArrangementDto(a.Id, a.Name, a.PartIdsJson, a.SongId, a.ModifiedAt))
                    .ToList(),
                Base("Songs", s.Id)));
            pushedIds.Add(new RootRef("Songs", s.Id));
        }

        // Media metadata (blobs travel separately via PUT /api/sync/media)
        var imageIds = IdsFor("OrganizationImages");
        foreach (var i in await db.OrganizationImages.AsNoTracking().Where(i => imageIds.Contains(i.Id)).ToListAsync(ct))
        {
            request.OrganizationImages.Add(new SyncRowPush<SyncOrganizationImageDto>(
                new SyncOrganizationImageDto(i.Id, i.FileName, i.ContentType, i.CreatedAt, i.ModifiedAt),
                Base("OrganizationImages", i.Id)));
            pushedIds.Add(new RootRef("OrganizationImages", i.Id));
        }

        var audioIds = IdsFor("OrganizationAudios");
        foreach (var a in await db.OrganizationAudios.AsNoTracking().Where(a => audioIds.Contains(a.Id)).ToListAsync(ct))
        {
            request.OrganizationAudios.Add(new SyncRowPush<SyncOrganizationAudioDto>(
                new SyncOrganizationAudioDto(a.Id, a.FileName, a.ContentType, a.CreatedAt, a.ModifiedAt),
                Base("OrganizationAudios", a.Id)));
            pushedIds.Add(new RootRef("OrganizationAudios", a.Id));
        }

        var overlayIds = IdsFor("OverlaySlides");
        foreach (var o in await db.OverlaySlides.AsNoTracking().Where(o => overlayIds.Contains(o.Id)).ToListAsync(ct))
        {
            request.OverlaySlides.Add(new SyncRowPush<SyncOverlaySlideDto>(
                new SyncOverlaySlideDto(o.Id, o.Title, o.Content, o.HasImage, o.SortOrder, o.ModifiedAt),
                Base("OverlaySlides", o.Id)));
            pushedIds.Add(new RootRef("OverlaySlides", o.Id));
        }

        // Presentations, as whole aggregates
        var presentationIds = IdsFor("Presentations");
        var presentations = await db.Presentations.AsNoTracking()
            .Include(p => p.Items).ThenInclude(i => i.Parts)
            .Include(p => p.SlideDecks)
            .Where(p => presentationIds.Contains(p.Id))
            .ToListAsync(ct);
        foreach (var p in presentations)
        {
            request.Presentations.Add(new SyncPresentationPush(
                new SyncPresentationDto(p.Id, p.Name, p.CreatedAt, p.CreatedBy, p.UpdatedAt, p.UpdatedBy,
                    p.IsTemplate, p.Description, p.LastUsedAt, p.UseCount, p.ScheduledDayOfWeek,
                    p.ScheduledTime, p.EventDate, p.EventTime, p.EventLocation, p.ThemeId, p.ModifiedAt),
                p.Items.OrderBy(i => i.SortOrder)
                    .Select(i => new SyncPresentationItemDto(i.Id, i.SourceId, i.Type, i.Title, i.ArrangementId, i.SortOrder, i.PresentationId, i.ModifiedAt))
                    .ToList(),
                p.Items.SelectMany(i => i.Parts)
                    .Select(part => new SyncPresentationItemPartDto(part.Id, part.Content, part.SortOrder, part.PresentationItemId, part.ModifiedAt))
                    .ToList(),
                p.SlideDecks
                    .Select(s => new SyncPresentationSlidesDto(s.Id, s.FileName, s.PageCount, s.CreatedAt, s.PresentationId, s.ModifiedAt))
                    .ToList(),
                Base("Presentations", p.Id)));
            pushedIds.Add(new RootRef("Presentations", p.Id));
        }

        // Settings
        var orgSettingIds = IdsFor("OrganizationSettings");
        foreach (var s in await db.OrganizationSettings.AsNoTracking().Where(s => orgSettingIds.Contains(s.Id)).ToListAsync(ct))
        {
            request.OrganizationSettings.Add(new SyncRowPush<SyncOrganizationSettingDto>(
                new SyncOrganizationSettingDto(s.Id, s.Key, s.Value, s.ModifiedAt),
                Base("OrganizationSettings", s.Id)));
            pushedIds.Add(new RootRef("OrganizationSettings", s.Id));
        }

        var userSettingIds = IdsFor("UserSettings");
        foreach (var s in await db.UserSettings.AsNoTracking().Where(s => userSettingIds.Contains(s.Id)).ToListAsync(ct))
        {
            request.UserSettings.Add(new SyncRowPush<SyncUserSettingDto>(
                new SyncUserSettingDto(s.Id, s.Key, s.Value, s.ModifiedAt),
                Base("UserSettings", s.Id)));
            pushedIds.Add(new RootRef("UserSettings", s.Id));
        }

        // Roots that no longer exist locally: a delete journal entry makes them delete pushes;
        // without one (an unresolvable orphan) they are silently consumed.
        foreach (var root in roots.Where(r => !pushedIds.Contains(r)))
        {
            if (deletedRoots.Contains(root))
                request.Deletes.Add(new SyncDeletePush(SyncTables.EntityTypeFor(root.Table), root.Id, Base(root.Table, root.Id)));
        }

        var count = request.SongPartLabels.Count + request.Songs.Count + request.OrganizationImages.Count
                    + request.OrganizationAudios.Count + request.OverlaySlides.Count + request.Presentations.Count
                    + request.OrganizationSettings.Count + request.UserSettings.Count + request.Deletes.Count;
        return count == 0 ? null : request;
    }

    private static async Task<Dictionary<RootRef, DateTimeOffset>> LoadBasesAsync(
        ClientDataContext db, HashSet<RootRef> roots, CancellationToken ct)
    {
        var bases = new Dictionary<RootRef, DateTimeOffset>();
        foreach (var group in roots.GroupBy(r => r.Table))
        {
            var table = group.Key;
            var ids = group.Select(r => r.Id).ToList();
            var rows = await db.SyncBase.AsNoTracking()
                .Where(b => b.EntityTable == table && ids.Contains(b.RowId))
                .ToListAsync(ct);
            foreach (var row in rows)
                bases[new RootRef(table, row.RowId)] = row.BaseModifiedAt;
        }
        return bases;
    }
}
