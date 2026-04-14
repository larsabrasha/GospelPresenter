using System.Text.Json;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Utils;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface ISongService
{
    IReadOnlyList<Song> GetSongsByOrganization(string organizationId, CallerContext caller);
    Song? GetSongById(string id, string organizationId, CallerContext caller);
    IReadOnlyList<Song> SearchByOrganization(string query, string organizationId, CallerContext caller);
    Task LoadSongsAsync();
    Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId, CallerContext caller);
    Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, CallerContext caller, bool replaceExisting = false);
    Task DeleteSongAsync(string id, string organizationId, CallerContext caller);
    Task<List<TrashedSong>> GetTrashedSongsAsync(string organizationId, CallerContext caller);
    Task RestoreFromTrashAsync(string id, string organizationId, CallerContext caller);
    Task PermanentlyDeleteSongAsync(string id, string organizationId, CallerContext caller);
    Task EmptyTrashAsync(string organizationId, CallerContext caller);
    Task RestoreAllFromTrashAsync(string organizationId, CallerContext caller);
    Task UpdateSongAsync(string id, string organizationId, string name, string? author, string? publisher, int? year, string? ccli, CallerContext caller);
    Task UpdateSongPartAsync(string songId, string organizationId, int partIndex, string? label, string content, CallerContext caller);
    Task UpdateSongPartsAsync(string songId, string organizationId, IReadOnlyDictionary<int, (string? Label, string Content)> edits, CallerContext caller);
    Task AddSongPartAsync(string songId, string organizationId, string? label, string content, CallerContext caller);
    Task DeleteSongPartAsync(string songId, string organizationId, int partIndex, CallerContext caller);
    Task MoveSongPartAsync(string songId, string organizationId, int fromIndex, int toIndex, CallerContext caller);
    Task<List<SongVersionSummary>> GetVersionsAsync(string songId, string organizationId, CallerContext caller);
    Task<SongVersionDetail?> GetVersionAsync(string versionId, string organizationId, CallerContext caller);
    Task RestoreVersionAsync(string songId, string organizationId, string versionId, CallerContext caller);
    Task<Song> CreateSongAsync(string name, string? author, string? publisher, int? year, string? ccli, List<SongPart> parts, string organizationId, CallerContext caller);
}

public class SongService(IDbContextFactory<PresentationContext> dbContextFactory) : ISongService
{
    private Dictionary<string, OrgSongCache> cacheByOrg = new();

    private void UpdateOrgCache(string organizationId, Action<OrgSongCache> mutator)
    {
        var newCache = new Dictionary<string, OrgSongCache>(cacheByOrg);
        var orgCache = newCache.TryGetValue(organizationId, out var existing)
            ? existing.Clone()
            : new OrgSongCache();
        mutator(orgCache);
        orgCache.RebuildIndex();
        newCache[organizationId] = orgCache;
        Interlocked.Exchange(ref cacheByOrg, newCache);
    }

    public IReadOnlyList<Song> GetSongsByOrganization(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        var snapshot = cacheByOrg;
        return snapshot.TryGetValue(organizationId, out var cache) ? cache.SongsSorted : [];
    }

    public async Task LoadSongsAsync()
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();

        // Auto-delete songs that have been in trash for more than 30 days
        var cutoff = DateTime.UtcNow.AddDays(-30);
        var expired = await db.Songs.Where(s => s.DeletedAt != null && s.DeletedAt < cutoff).ToListAsync();
        if (expired.Count > 0)
        {
            db.Songs.RemoveRange(expired);
            await db.SaveChangesAsync();
        }

        var dbSongs = await db.Songs
            .Where(s => s.DeletedAt == null)
            .Include(s => s.Parts.OrderBy(p => p.SortOrder))
            .OrderBy(s => s.Name)
            .AsNoTracking()
            .ToListAsync();

        var newCache = new Dictionary<string, OrgSongCache>();
        foreach (var dbSong in dbSongs)
        {
            var song = ToStateSong(dbSong);
            if (!newCache.TryGetValue(song.OrganizationId, out var orgCache))
            {
                orgCache = new OrgSongCache();
                newCache[song.OrganizationId] = orgCache;
            }
            orgCache.SongsById[song.Id] = song;
        }

        foreach (var cache in newCache.Values)
            cache.RebuildIndex();

        Interlocked.Exchange(ref cacheByOrg, newCache);
    }

    public async Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var nameList = names.ToList();
        var existingNames = await db.Songs
            .Where(s => s.OrganizationId == organizationId && s.DeletedAt == null)
            .Select(s => s.Name)
            .ToListAsync();

        var existingSet = new HashSet<string>(existingNames, StringComparer.OrdinalIgnoreCase);
        return nameList.Where(n => existingSet.Contains(n)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, CallerContext caller, bool replaceExisting = false)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();

        var existingSongs = await db.Songs
            .Where(s => s.OrganizationId == organizationId && s.DeletedAt == null)
            .Include(s => s.Parts)
            .ToListAsync();

        var existingByName = new Dictionary<string, Models.DbSong>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in existingSongs)
            existingByName.TryAdd(s.Name, s);

        var songCount = existingSongs.Count;
        int imported = 0, replaced = 0, skipped = 0;

        foreach (var (fileName, data) in files)
        {
            var fallbackTitle = Path.GetFileNameWithoutExtension(fileName);
            var parsed = ProPresenterParser.Parse(data, fallbackTitle);
            if (parsed is null) continue;

            parsed = parsed with
            {
                Name = ValidationHelper.Truncate(parsed.Name, AppConstraints.NameMaxLength) ?? "",
                Author = ValidationHelper.Truncate(parsed.Author, AppConstraints.SongAuthorMaxLength),
                Publisher = ValidationHelper.Truncate(parsed.Publisher, AppConstraints.SongPublisherMaxLength),
                Ccli = ValidationHelper.Truncate(parsed.Ccli, AppConstraints.SongCcliMaxLength),
                Parts = parsed.Parts.Select(p => p with
                {
                    Label = ValidationHelper.Truncate(p.Label, AppConstraints.SongPartLabelMaxLength),
                    Content = ValidationHelper.Truncate(p.Content, AppConstraints.SongPartContentMaxLength) ?? ""
                }).Take(AppConstraints.MaxSongPartsPerSong).ToList()
            };

            if (existingByName.TryGetValue(parsed.Name, out var existing))
            {
                if (!replaceExisting)
                {
                    skipped++;
                    continue;
                }

                existing.Author = parsed.Author;
                existing.Publisher = parsed.Publisher;
                existing.Year = parsed.Year;
                existing.Ccli = parsed.Ccli;
                existing.Parts.Clear();
                for (var i = 0; i < parsed.Parts.Count; i++)
                {
                    existing.Parts.Add(new Models.DbSongPart
                    {
                        Label = parsed.Parts[i].Label,
                        Content = parsed.Parts[i].Content,
                        SortOrder = i
                    });
                }

                replaced++;
            }
            else
            {
                if (songCount >= AppConstraints.MaxSongsPerOrg)
                {
                    skipped++;
                    continue;
                }

                var dbSong = new Models.DbSong
                {
                    Name = parsed.Name,
                    Author = parsed.Author,
                    Publisher = parsed.Publisher,
                    Year = parsed.Year,
                    Ccli = parsed.Ccli,
                    OrganizationId = organizationId
                };

                for (var i = 0; i < parsed.Parts.Count; i++)
                {
                    dbSong.Parts.Add(new Models.DbSongPart
                    {
                        Label = parsed.Parts[i].Label,
                        Content = parsed.Parts[i].Content,
                        SortOrder = i
                    });
                }

                db.Songs.Add(dbSong);
                existingByName[parsed.Name] = dbSong;
                songCount++;
                imported++;
            }
        }

        if (imported > 0 || replaced > 0)
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            await LoadSongsAsync();
        }

        return new ImportResult(imported, replaced, skipped);
    }

    public async Task DeleteSongAsync(string id, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == id && s.OrganizationId == organizationId);
        if (song is not null)
        {
            song.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            UpdateOrgCache(organizationId, c => c.SongsById.Remove(id));
        }
    }

    public async Task<List<TrashedSong>> GetTrashedSongsAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        return await db.Songs
            .Where(s => s.DeletedAt != null && s.OrganizationId == organizationId)
            .OrderByDescending(s => s.DeletedAt)
            .Select(s => new TrashedSong(s.Id, s.Name, s.Author, s.DeletedAt!.Value))
            .ToListAsync();
    }

    public async Task RestoreFromTrashAsync(string id, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == id && s.OrganizationId == organizationId && s.DeletedAt != null);
        if (song is not null)
        {
            song.DeletedAt = null;
            await db.SaveChangesAsync();
            var restored = ToStateSong(song);
            UpdateOrgCache(organizationId, c => c.SongsById[id] = restored);
        }
    }

    public async Task PermanentlyDeleteSongAsync(string id, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == id && s.OrganizationId == organizationId && s.DeletedAt != null);
        if (song is not null)
        {
            db.Songs.Remove(song);
            await db.SaveChangesAsync();
        }
    }

    public async Task EmptyTrashAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var trashed = await db.Songs.Where(s => s.DeletedAt != null && s.OrganizationId == organizationId).ToListAsync();
        if (trashed.Count > 0)
        {
            db.Songs.RemoveRange(trashed);
            await db.SaveChangesAsync();
        }
    }

    public async Task RestoreAllFromTrashAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var trashed = await db.Songs
            .Where(s => s.DeletedAt != null && s.OrganizationId == organizationId)
            .Include(s => s.Parts.OrderBy(p => p.SortOrder))
            .ToListAsync();

        foreach (var song in trashed)
        {
            song.DeletedAt = null;
        }

        if (trashed.Count > 0)
        {
            await db.SaveChangesAsync();
            var restoredSongs = trashed.Select(s => ToStateSong(s)).ToList();
            UpdateOrgCache(organizationId, c =>
            {
                foreach (var song in restoredSongs)
                    c.SongsById[song.Id] = song;
            });
        }
    }

    public async Task UpdateSongAsync(string id, string organizationId, string name, string? author, string? publisher, int? year, string? ccli, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        ValidateSongFields(name, author, publisher, year, ccli);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == id && s.OrganizationId == organizationId);
        if (song is null) return;

        await using var transaction = await db.Database.BeginTransactionAsync();
        await SaveVersionSnapshotAsync(db, song);

        song.Name = name;
        song.Author = author;
        song.Publisher = publisher;
        song.Year = year;
        song.Ccli = ccli;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        var snapshot = cacheByOrg;
        if (snapshot.TryGetValue(organizationId, out var cache) && cache.SongsById.TryGetValue(id, out var existing))
        {
            var updated = existing with { Name = name, Author = author, Publisher = publisher, Year = year, Ccli = ccli };
            UpdateOrgCache(organizationId, c => c.SongsById[id] = updated);
        }
    }

    public async Task UpdateSongPartAsync(string songId, string organizationId, int partIndex, string? label, string content, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(label, AppConstraints.SongPartLabelMaxLength, "Label");
        ValidationHelper.RequireMaxLength(content, AppConstraints.SongPartContentMaxLength, "Content");
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;

        var parts = song.Parts;
        if (partIndex < 0 || partIndex >= parts.Count) return;

        await using var transaction = await db.Database.BeginTransactionAsync();
        await SaveVersionSnapshotAsync(db, song);

        parts[partIndex].Label = label;
        parts[partIndex].Content = content;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        await ReloadSong(songId);
    }

    public async Task UpdateSongPartsAsync(string songId, string organizationId, IReadOnlyDictionary<int, (string? Label, string Content)> edits, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        if (edits.Count == 0) return;
        foreach (var (_, edit) in edits)
        {
            ValidationHelper.RequireMaxLength(edit.Label, AppConstraints.SongPartLabelMaxLength, "Label");
            ValidationHelper.RequireMaxLength(edit.Content, AppConstraints.SongPartContentMaxLength, "Content");
        }

        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;

        var parts = song.Parts;
        await using var transaction = await db.Database.BeginTransactionAsync();
        await SaveVersionSnapshotAsync(db, song);

        foreach (var (index, edit) in edits)
        {
            if (index < 0 || index >= parts.Count) continue;
            parts[index].Label = edit.Label;
            parts[index].Content = edit.Content;
        }

        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        await ReloadSong(songId);
    }

    public async Task AddSongPartAsync(string songId, string organizationId, string? label, string content, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(label, AppConstraints.SongPartLabelMaxLength, "Label");
        ValidationHelper.RequireMaxLength(content, AppConstraints.SongPartContentMaxLength, "Content");
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;
        if (song.Parts.Count >= AppConstraints.MaxSongPartsPerSong)
            throw new InvalidOperationException($"The maximum number of song parts ({AppConstraints.MaxSongPartsPerSong}) has been reached.");

        await using var transaction = await db.Database.BeginTransactionAsync();
        await SaveVersionSnapshotAsync(db, song);

        var maxOrder = song.Parts.Count > 0 ? song.Parts.Max(p => p.SortOrder) : -1;
        db.SongParts.Add(new Models.DbSongPart
        {
            SongId = songId,
            Label = label,
            Content = content,
            SortOrder = maxOrder + 1
        });
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        await ReloadSong(songId);
    }

    public async Task DeleteSongPartAsync(string songId, string organizationId, int partIndex, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;

        var parts = song.Parts;
        if (partIndex < 0 || partIndex >= parts.Count) return;

        await using var transaction = await db.Database.BeginTransactionAsync();
        await SaveVersionSnapshotAsync(db, song);

        db.SongParts.Remove(parts[partIndex]);
        parts.RemoveAt(partIndex);
        for (var i = 0; i < parts.Count; i++)
            parts[i].SortOrder = i;

        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        await ReloadSong(songId);
    }

    public async Task MoveSongPartAsync(string songId, string organizationId, int fromIndex, int toIndex, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;

        var parts = song.Parts;
        if (fromIndex < 0 || fromIndex >= parts.Count || toIndex < 0 || toIndex >= parts.Count || fromIndex == toIndex) return;

        await using var transaction = await db.Database.BeginTransactionAsync();
        await SaveVersionSnapshotAsync(db, song);

        var item = parts[fromIndex];
        parts.RemoveAt(fromIndex);
        parts.Insert(toIndex, item);

        for (var i = 0; i < parts.Count; i++)
            parts[i].SortOrder = i;

        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        await ReloadSong(songId);
    }

    public async Task<List<SongVersionSummary>> GetVersionsAsync(string songId, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();

        if (!await db.Songs.AnyAsync(s => s.Id == songId && s.OrganizationId == organizationId))
            return [];

        return await db.SongVersions
            .Where(v => v.SongId == songId)
            .OrderByDescending(v => v.CreatedAt)
            .Select(v => new SongVersionSummary(v.Id, v.Name, v.CreatedAt))
            .ToListAsync();
    }

    public async Task<SongVersionDetail?> GetVersionAsync(string versionId, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var v = await db.SongVersions
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == versionId && x.Song.OrganizationId == organizationId);
        if (v is null) return null;

        var parts = JsonSerializer.Deserialize<List<SongPart>>(v.PartsJson) ?? [];
        return new SongVersionDetail(v.Id, v.SongId, v.Name, v.Author, v.CreatedAt, parts);
    }

    public async Task RestoreVersionAsync(string songId, string organizationId, string versionId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var version = await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == versionId && x.SongId == songId);
        if (version is null) return;

        var song = await db.Songs.Include(s => s.Parts).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;

        await using var transaction = await db.Database.BeginTransactionAsync();

        // Save current state as a version before restoring
        await SaveVersionSnapshotAsync(db, song, forceNew: true);

        var parts = JsonSerializer.Deserialize<List<SongPart>>(version.PartsJson) ?? [];

        song.Name = version.Name;
        song.Author = version.Author;
        song.Parts.Clear();
        for (var i = 0; i < parts.Count; i++)
        {
            song.Parts.Add(new Models.DbSongPart
            {
                Label = parts[i].Label,
                Content = parts[i].Content,
                SortOrder = i
            });
        }

        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        await ReloadSong(songId);
    }

    private static void ValidateSongFields(string name, string? author, string? publisher, int? year, string? ccli)
    {
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(author, AppConstraints.SongAuthorMaxLength, "Author");
        ValidationHelper.RequireMaxLength(publisher, AppConstraints.SongPublisherMaxLength, "Publisher");
        ValidationHelper.RequireMaxLength(ccli, AppConstraints.SongCcliMaxLength, "CCLI");
        ValidationHelper.RequireRange(year, AppConstraints.SongYearMin, AppConstraints.SongYearMax, "Year");
    }

    public async Task<Song> CreateSongAsync(string name, string? author, string? publisher, int? year, string? ccli, List<SongPart> parts, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        ValidateSongFields(name, author, publisher, year, ccli);
        await using var db = await dbContextFactory.CreateDbContextAsync();
        await ValidationHelper.RequireMaxCountAsync(
            db.Songs.Where(s => s.OrganizationId == organizationId && s.DeletedAt == null),
            AppConstraints.MaxSongsPerOrg, "songs");

        var dbSong = new Models.DbSong
        {
            Name = name,
            Author = author,
            Publisher = publisher,
            Year = year,
            Ccli = ccli,
            OrganizationId = organizationId
        };

        for (var i = 0; i < parts.Count; i++)
        {
            dbSong.Parts.Add(new Models.DbSongPart
            {
                Label = parts[i].Label,
                Content = parts[i].Content,
                SortOrder = i
            });
        }

        db.Songs.Add(dbSong);

        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        var song = ToStateSong(dbSong);
        UpdateOrgCache(organizationId, c => c.SongsById[song.Id] = song);

        return song;
    }

    private static readonly TimeSpan SessionWindow = TimeSpan.FromMinutes(30);

    private async Task SaveVersionSnapshotAsync(PresentationContext db, Models.DbSong song, bool forceNew = false)
    {
        var partsJson = JsonSerializer.Serialize(
            song.Parts.Select(p => new SongPart(p.Label, p.Content)).ToList());

        if (!forceNew)
        {
            // Check if there's a recent version within the session window
            var recent = await db.SongVersions
                .Where(v => v.SongId == song.Id)
                .OrderByDescending(v => v.CreatedAt)
                .FirstOrDefaultAsync();

            if (recent is not null && DateTime.UtcNow - recent.CreatedAt < SessionWindow)
            {
                // Update the existing version's timestamp (the snapshot stays as-is from the session start)
                recent.CreatedAt = DateTime.UtcNow;
                return;
            }
        }

        db.SongVersions.Add(new Models.DbSongVersion
        {
            SongId = song.Id,
            Name = song.Name,
            Author = song.Author,
            PartsJson = partsJson,
            CreatedAt = DateTime.UtcNow
        });

        // Prune old versions beyond the limit
        var oldVersions = await db.SongVersions
            .Where(v => v.SongId == song.Id)
            .OrderByDescending(v => v.CreatedAt)
            .Skip(AppConstraints.MaxSongVersionsPerSong)
            .ToListAsync();

        if (oldVersions.Count > 0)
            db.SongVersions.RemoveRange(oldVersions);
    }

    public Song? GetSongById(string id, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        var snapshot = cacheByOrg;
        return snapshot.TryGetValue(organizationId, out var cache)
            ? cache.SongsById.GetValueOrDefault(id)
            : null;
    }

    public IReadOnlyList<Song> SearchByOrganization(string query, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        if (string.IsNullOrWhiteSpace(query))
            return GetSongsByOrganization(organizationId, caller);

        var snapshot = cacheByOrg;
        if (!snapshot.TryGetValue(organizationId, out var cache))
            return [];

        var normalized = query.Normalize().ToLowerInvariant();
        var terms = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var strippedTerms = terms.Select(TextUtils.RemoveDiacritics).ToArray();
        var phrase = string.Join(" ", terms);
        var strippedPhrase = string.Join(" ", strippedTerms);

        var scored = new List<(Song Song, double Score)>();

        foreach (var entry in cache.SearchIndex)
        {
            var score = ScoreMatch(entry, terms, strippedTerms, phrase, strippedPhrase);
            if (score > 0)
                scored.Add((entry.Song, score));
        }

        return scored
            .OrderByDescending(x => x.Score)
            .Select(x => x.Song)
            .ToList();
    }

    private static double ScoreMatch(SongSearchEntry entry, string[] terms, string[] strippedTerms,
        string phrase, string strippedPhrase)
    {
        double score = 0;
        int matchedTerms = 0;

        for (int i = 0; i < terms.Length; i++)
        {
            var term = terms[i];
            var stripped = strippedTerms[i];
            double termScore = 0;

            // Match word prefixes: "vi" matches "vi vill" but not "evighet"
            if (TextUtils.ContainsWordPrefix(entry.Name, term))
            {
                termScore = 10;
                if (entry.Name.StartsWith(term, StringComparison.Ordinal))
                    termScore += 5;
            }
            else if (TextUtils.ContainsWordPrefix(entry.NameStripped, stripped))
            {
                termScore = 8;
                if (entry.NameStripped.StartsWith(stripped, StringComparison.Ordinal))
                    termScore += 5;
            }

            if (termScore == 0)
            {
                if (TextUtils.ContainsWordPrefix(entry.FirstPart, term))
                    termScore = 3;
                else if (TextUtils.ContainsWordPrefix(entry.FirstPartStripped, stripped))
                    termScore = 2.5;
            }

            if (termScore == 0)
            {
                if (TextUtils.ContainsWordPrefix(entry.AllText, term))
                    termScore = 1;
                else if (TextUtils.ContainsWordPrefix(entry.AllTextStripped, stripped))
                    termScore = 0.5;
            }

            if (termScore > 0)
            {
                score += termScore;
                matchedTerms++;
            }
        }

        if (matchedTerms < terms.Length)
            return 0;

        // Exact title match bonus
        if (entry.Name == phrase)
            score += 100;
        else if (entry.NameStripped == strippedPhrase)
            score += 90;

        // Phrase bonus: consecutive terms appearing together rank higher
        if (terms.Length > 1)
        {
            if (TextUtils.ContainsWordPrefix(entry.Name, phrase))
                score += 50;
            else if (TextUtils.ContainsWordPrefix(entry.NameStripped, strippedPhrase))
                score += 45;
            else if (TextUtils.ContainsWordPrefix(entry.FirstPart, phrase))
                score += 25;
            else if (TextUtils.ContainsWordPrefix(entry.FirstPartStripped, strippedPhrase))
                score += 22;
            else if (TextUtils.ContainsWordPrefix(entry.AllText, phrase))
                score += 10;
            else if (TextUtils.ContainsWordPrefix(entry.AllTextStripped, strippedPhrase))
                score += 8;
        }

        return score;
    }

    protected void LoadTestSongs(Song[] songs)
    {
        var newCache = new Dictionary<string, OrgSongCache>();
        foreach (var song in songs)
        {
            if (!newCache.TryGetValue(song.OrganizationId, out var orgCache))
            {
                orgCache = new OrgSongCache();
                newCache[song.OrganizationId] = orgCache;
            }
            orgCache.SongsById[song.Id] = song;
        }
        foreach (var cache in newCache.Values)
            cache.RebuildIndex();
        Interlocked.Exchange(ref cacheByOrg, newCache);
    }

    private async Task ReloadSong(string songId)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var dbSong = await db.Songs
            .Include(s => s.Parts.OrderBy(p => p.SortOrder))
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == songId);

        if (dbSong is not null)
        {
            var song = ToStateSong(dbSong);
            UpdateOrgCache(song.OrganizationId, c => c.SongsById[songId] = song);
        }
    }

    private static Song ToStateSong(Models.DbSong dbSong)
    {
        var parts = dbSong.Parts
            .Select(p => new SongPart(p.Label, p.Content))
            .ToList();

        return new Song(dbSong.Id, dbSong.Name, dbSong.Author, dbSong.Publisher, dbSong.Year, dbSong.Ccli, parts, dbSong.OrganizationId);
    }

    private record SongSearchEntry(
        Song Song,
        string Name, string NameStripped,
        string FirstPart, string FirstPartStripped,
        string AllText, string AllTextStripped);

    private class OrgSongCache
    {
        public Dictionary<string, Song> SongsById { get; init; } = new();
        public List<Song> SongsSorted { get; private set; } = [];
        public List<SongSearchEntry> SearchIndex { get; private set; } = [];

        public OrgSongCache Clone() => new() { SongsById = new Dictionary<string, Song>(SongsById) };

        public void RebuildIndex()
        {
            SongsSorted = SongsById.Values
                .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            SearchIndex = SongsSorted.Select(song =>
            {
                var name = song.Name.Normalize().ToLowerInvariant();
                var firstPart = song.Parts.Count > 0 ? song.Parts[0].Content.Normalize().ToLowerInvariant() : "";
                var allText = string.Concat(song.Name, " ", song.Author, " ", string.Join(" ", song.Parts.Select(p => p.Content))).Normalize().ToLowerInvariant();
                return new SongSearchEntry(
                    song,
                    name, TextUtils.RemoveDiacritics(name),
                    firstPart, TextUtils.RemoveDiacritics(firstPart),
                    allText, TextUtils.RemoveDiacritics(allText));
            }).ToList();
        }
    }
}

public record ImportResult(int Imported, int Replaced, int Skipped)
{
    public int Total => Imported + Replaced + Skipped;
}

public record TrashedSong(string Id, string Name, string? Author, DateTime DeletedAt)
{
    public int DaysRemaining => Math.Max(0, 30 - (int)(DateTime.UtcNow - DeletedAt).TotalDays);
}

public record SongVersionSummary(string Id, string Name, DateTime CreatedAt);

public record SongVersionDetail(
    string Id,
    string SongId,
    string Name,
    string? Author,
    DateTime CreatedAt,
    List<SongPart> Parts
);
