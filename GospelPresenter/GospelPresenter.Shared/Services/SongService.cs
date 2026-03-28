using System.Text.Json;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
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
    private readonly Dictionary<string, OrgSongCache> cacheByOrg = new();

    private OrgSongCache GetOrCreateCache(string organizationId)
    {
        if (!cacheByOrg.TryGetValue(organizationId, out var cache))
        {
            cache = new OrgSongCache();
            cacheByOrg[organizationId] = cache;
        }
        return cache;
    }

    public IReadOnlyList<Song> GetSongsByOrganization(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        return cacheByOrg.TryGetValue(organizationId, out var cache) ? cache.SongsSorted : [];
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

        cacheByOrg.Clear();
        foreach (var dbSong in dbSongs)
        {
            var song = ToStateSong(dbSong);
            var cache = GetOrCreateCache(song.OrganizationId);
            cache.SongsById[song.Id] = song;
        }

        foreach (var cache in cacheByOrg.Values)
            cache.RebuildIndex();
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

        int imported = 0, replaced = 0, skipped = 0;

        foreach (var (fileName, data) in files)
        {
            var fallbackTitle = Path.GetFileNameWithoutExtension(fileName);
            var parsed = ProPresenterParser.Parse(data, fallbackTitle);
            if (parsed is null) continue;

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
            if (cacheByOrg.TryGetValue(organizationId, out var cache))
            {
                cache.SongsById.Remove(id);
                cache.RebuildIndex();
            }
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
            var cache = GetOrCreateCache(organizationId);
            cache.SongsById[id] = ToStateSong(song);
            cache.RebuildIndex();
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
            var cache = GetOrCreateCache(organizationId);
            foreach (var song in trashed)
                cache.SongsById[song.Id] = ToStateSong(song);
            cache.RebuildIndex();
        }
    }

    public async Task UpdateSongAsync(string id, string organizationId, string name, string? author, string? publisher, int? year, string? ccli, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
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

        if (cacheByOrg.TryGetValue(organizationId, out var cache) && cache.SongsById.TryGetValue(id, out var existing))
        {
            cache.SongsById[id] = existing with { Name = name, Author = author, Publisher = publisher, Year = year, Ccli = ccli };
            cache.RebuildIndex();
        }
    }

    public async Task UpdateSongPartAsync(string songId, string organizationId, int partIndex, string? label, string content, CallerContext caller)
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
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId && s.OrganizationId == organizationId);
        if (song is null) return;

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

    public async Task<Song> CreateSongAsync(string name, string? author, string? publisher, int? year, string? ccli, List<SongPart> parts, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);
        await using var db = await dbContextFactory.CreateDbContextAsync();

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
        var cache = GetOrCreateCache(organizationId);
        cache.SongsById[song.Id] = song;
        cache.RebuildIndex();

        return song;
    }

    private static readonly TimeSpan SessionWindow = TimeSpan.FromMinutes(30);
    private const int MaxVersionsPerSong = 50;

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
            .Skip(MaxVersionsPerSong)
            .ToListAsync();

        if (oldVersions.Count > 0)
            db.SongVersions.RemoveRange(oldVersions);
    }

    public Song? GetSongById(string id, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        return cacheByOrg.TryGetValue(organizationId, out var cache)
            ? cache.SongsById.GetValueOrDefault(id)
            : null;
    }

    public IReadOnlyList<Song> SearchByOrganization(string query, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);
        if (string.IsNullOrWhiteSpace(query))
            return GetSongsByOrganization(organizationId, caller);

        if (!cacheByOrg.TryGetValue(organizationId, out var cache))
            return [];

        var terms = query.Normalize().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);

        var scored = new List<(Song Song, double Score)>();

        foreach (var entry in cache.SearchIndex)
        {
            var score = ScoreMatch(entry, terms);
            if (score > 0)
                scored.Add((entry.Song, score));
        }

        return scored
            .OrderByDescending(x => x.Score)
            .Select(x => x.Song)
            .ToList();
    }

    private static double ScoreMatch(SongSearchEntry entry, string[] terms)
    {
        double score = 0;
        int matchedTerms = 0;

        foreach (var term in terms)
        {
            if (entry.Name.Contains(term, StringComparison.Ordinal))
            {
                score += 10;
                matchedTerms++;
                if (entry.Name.StartsWith(term, StringComparison.Ordinal))
                    score += 5;
            }
            else if (entry.FirstPart.Contains(term, StringComparison.Ordinal))
            {
                score += 3;
                matchedTerms++;
            }
            else if (entry.AllText.Contains(term, StringComparison.Ordinal))
            {
                score += 1;
                matchedTerms++;
            }
        }

        if (matchedTerms == 0)
            return 0;

        if (matchedTerms == terms.Length)
            score += 20;

        score *= (double)matchedTerms / terms.Length;

        return score;
    }

    protected void LoadTestSongs(Song[] songs)
    {
        cacheByOrg.Clear();
        foreach (var song in songs)
        {
            var cache = GetOrCreateCache(song.OrganizationId);
            cache.SongsById[song.Id] = song;
        }
        foreach (var cache in cacheByOrg.Values)
            cache.RebuildIndex();
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
            var cache = GetOrCreateCache(song.OrganizationId);
            cache.SongsById[songId] = song;
            cache.RebuildIndex();
        }
    }

    private static Song ToStateSong(Models.DbSong dbSong)
    {
        var parts = dbSong.Parts
            .Select(p => new SongPart(p.Label, p.Content))
            .ToList();

        return new Song(dbSong.Id, dbSong.Name, dbSong.Author, dbSong.Publisher, dbSong.Year, dbSong.Ccli, parts, dbSong.OrganizationId);
    }

    private record SongSearchEntry(Song Song, string Name, string FirstPart, string AllText);

    private class OrgSongCache
    {
        public Dictionary<string, Song> SongsById { get; } = new();
        public List<Song> SongsSorted { get; private set; } = [];
        public List<SongSearchEntry> SearchIndex { get; private set; } = [];

        public void RebuildIndex()
        {
            SongsSorted = SongsById.Values
                .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            SearchIndex = SongsSorted.Select(song => new SongSearchEntry(
                song,
                song.Name.Normalize().ToLowerInvariant(),
                song.Parts.Count > 0 ? song.Parts[0].Content.Normalize().ToLowerInvariant() : "",
                string.Concat(song.Name, " ", song.Author, " ", string.Join(" ", song.Parts.Select(p => p.Content))).Normalize().ToLowerInvariant()
            )).ToList();
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
