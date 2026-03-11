using System.Text.Json;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.State;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface ISongService
{
    IReadOnlyList<Song> Songs { get; }
    Song? GetSongById(string id);
    IReadOnlyList<Song> Search(string query);
    Task LoadSongsAsync();
    Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId);
    Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, bool replaceExisting = false);
    Task DeleteSongAsync(string id);
    Task<List<TrashedSong>> GetTrashedSongsAsync();
    Task RestoreFromTrashAsync(string id);
    Task PermanentlyDeleteSongAsync(string id);
    Task EmptyTrashAsync();
    Task RestoreAllFromTrashAsync();
    Task UpdateSongAsync(string id, string name, string? author);
    Task UpdateSongPartAsync(string songId, int partIndex, string? label, string content);
    Task AddSongPartAsync(string songId, string? label, string content);
    Task DeleteSongPartAsync(string songId, int partIndex);
    Task MoveSongPartAsync(string songId, int fromIndex, int toIndex);
    Task<List<SongVersionSummary>> GetVersionsAsync(string songId);
    Task<SongVersionDetail?> GetVersionAsync(string versionId);
    Task RestoreVersionAsync(string songId, string versionId);
}

public class SongService(IDbContextFactory<PresentationContext> dbContextFactory) : ISongService
{
    private readonly Dictionary<string, Song> songsById = new();
    private List<Song> songsSorted = [];
    private List<SongSearchEntry> searchIndex = [];

    public IReadOnlyList<Song> Songs => songsSorted;

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

        songsById.Clear();
        foreach (var dbSong in dbSongs)
        {
            var song = ToStateSong(dbSong);
            songsById[song.Id] = song;
        }

        RebuildIndex();
    }

    public async Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var nameList = names.ToList();
        var existingNames = await db.Songs
            .Where(s => s.OrganizationId == organizationId && s.DeletedAt == null)
            .Select(s => s.Name)
            .ToListAsync();

        var existingSet = new HashSet<string>(existingNames, StringComparer.OrdinalIgnoreCase);
        return nameList.Where(n => existingSet.Contains(n)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, bool replaceExisting = false)
    {
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
            await db.SaveChangesAsync();
            await LoadSongsAsync();
        }

        return new ImportResult(imported, replaced, skipped);
    }

    public async Task DeleteSongAsync(string id)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.FindAsync(id);
        if (song is not null)
        {
            song.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            songsById.Remove(id);
            RebuildIndex();
        }
    }

    public async Task<List<TrashedSong>> GetTrashedSongsAsync()
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        return await db.Songs
            .Where(s => s.DeletedAt != null)
            .OrderByDescending(s => s.DeletedAt)
            .Select(s => new TrashedSong(s.Id, s.Name, s.Author, s.DeletedAt!.Value))
            .ToListAsync();
    }

    public async Task RestoreFromTrashAsync(string id)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == id && s.DeletedAt != null);
        if (song is not null)
        {
            song.DeletedAt = null;
            await db.SaveChangesAsync();
            songsById[id] = ToStateSong(song);
            RebuildIndex();
        }
    }

    public async Task PermanentlyDeleteSongAsync(string id)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == id && s.DeletedAt != null);
        if (song is not null)
        {
            db.Songs.Remove(song);
            await db.SaveChangesAsync();
        }
    }

    public async Task EmptyTrashAsync()
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var trashed = await db.Songs.Where(s => s.DeletedAt != null).ToListAsync();
        if (trashed.Count > 0)
        {
            db.Songs.RemoveRange(trashed);
            await db.SaveChangesAsync();
        }
    }

    public async Task RestoreAllFromTrashAsync()
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var trashed = await db.Songs
            .Where(s => s.DeletedAt != null)
            .Include(s => s.Parts.OrderBy(p => p.SortOrder))
            .ToListAsync();

        foreach (var song in trashed)
        {
            song.DeletedAt = null;
            songsById[song.Id] = ToStateSong(song);
        }

        if (trashed.Count > 0)
        {
            await db.SaveChangesAsync();
            RebuildIndex();
        }
    }

    public async Task UpdateSongAsync(string id, string name, string? author)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == id);
        if (song is null) return;

        await SaveVersionSnapshotAsync(db, song);

        song.Name = name;
        song.Author = author;
        await db.SaveChangesAsync();

        if (songsById.TryGetValue(id, out var existing))
        {
            songsById[id] = existing with { Name = name, Author = author };
            RebuildIndex();
        }
    }

    public async Task UpdateSongPartAsync(string songId, int partIndex, string? label, string content)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId);
        if (song is null) return;

        var parts = song.Parts;
        if (partIndex < 0 || partIndex >= parts.Count) return;

        await SaveVersionSnapshotAsync(db, song);

        parts[partIndex].Label = label;
        parts[partIndex].Content = content;
        await db.SaveChangesAsync();
        await ReloadSong(songId);
    }

    public async Task AddSongPartAsync(string songId, string? label, string content)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId);
        if (song is null) return;

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
        await ReloadSong(songId);
    }

    public async Task DeleteSongPartAsync(string songId, int partIndex)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId);
        if (song is null) return;

        var parts = song.Parts;
        if (partIndex < 0 || partIndex >= parts.Count) return;

        await SaveVersionSnapshotAsync(db, song);

        db.SongParts.Remove(parts[partIndex]);
        parts.RemoveAt(partIndex);
        for (var i = 0; i < parts.Count; i++)
            parts[i].SortOrder = i;

        await db.SaveChangesAsync();
        await ReloadSong(songId);
    }

    public async Task MoveSongPartAsync(string songId, int fromIndex, int toIndex)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.Include(s => s.Parts.OrderBy(p => p.SortOrder)).FirstOrDefaultAsync(s => s.Id == songId);
        if (song is null) return;

        var parts = song.Parts;
        if (fromIndex < 0 || fromIndex >= parts.Count || toIndex < 0 || toIndex >= parts.Count || fromIndex == toIndex) return;

        await SaveVersionSnapshotAsync(db, song);

        var item = parts[fromIndex];
        parts.RemoveAt(fromIndex);
        parts.Insert(toIndex, item);

        for (var i = 0; i < parts.Count; i++)
            parts[i].SortOrder = i;

        await db.SaveChangesAsync();
        await ReloadSong(songId);
    }

    public async Task<List<SongVersionSummary>> GetVersionsAsync(string songId)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        return await db.SongVersions
            .Where(v => v.SongId == songId)
            .OrderByDescending(v => v.CreatedAt)
            .Select(v => new SongVersionSummary(v.Id, v.Name, v.CreatedAt))
            .ToListAsync();
    }

    public async Task<SongVersionDetail?> GetVersionAsync(string versionId)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var v = await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == versionId);
        if (v is null) return null;

        var parts = JsonSerializer.Deserialize<List<SongPart>>(v.PartsJson) ?? [];
        return new SongVersionDetail(v.Id, v.SongId, v.Name, v.Author, v.CreatedAt, parts);
    }

    public async Task RestoreVersionAsync(string songId, string versionId)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var version = await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == versionId && x.SongId == songId);
        if (version is null) return;

        var song = await db.Songs.Include(s => s.Parts).FirstOrDefaultAsync(s => s.Id == songId);
        if (song is null) return;

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
        await ReloadSong(songId);
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

    public Song? GetSongById(string id)
    {
        return songsById.GetValueOrDefault(id);
    }

    public IReadOnlyList<Song> Search(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return songsSorted;

        var terms = query.Normalize().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);

        var scored = new List<(Song Song, double Score)>();

        foreach (var entry in searchIndex)
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
        foreach (var song in songs)
            songsById[song.Id] = song;

        RebuildIndex();
    }

    private void RebuildIndex()
    {
        songsSorted = songsById.Values
            .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        searchIndex = songsSorted.Select(song => new SongSearchEntry(
            song,
            song.Name.Normalize().ToLowerInvariant(),
            song.Parts.Count > 0 ? song.Parts[0].Content.Normalize().ToLowerInvariant() : "",
            $"{song.Name} {song.Author} {string.Join(" ", song.Parts.Select(p => p.Content))}".Normalize().ToLowerInvariant()
        )).ToList();
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
            songsById[songId] = ToStateSong(dbSong);
            RebuildIndex();
        }
    }

    private static Song ToStateSong(Models.DbSong dbSong)
    {
        var parts = dbSong.Parts
            .Select(p => new SongPart(p.Label, p.Content))
            .ToList();

        return new Song(dbSong.Id, dbSong.Name, dbSong.Author, dbSong.Publisher, dbSong.Year, dbSong.Ccli, parts);
    }

    private record SongSearchEntry(Song Song, string Name, string FirstPart, string AllText);
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
