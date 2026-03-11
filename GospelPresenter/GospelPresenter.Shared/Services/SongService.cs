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
    Task UpdateSongAsync(string id, string name, string? author);
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
        var dbSongs = await db.Songs
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
            .Where(s => s.OrganizationId == organizationId)
            .Select(s => s.Name)
            .ToListAsync();

        var existingSet = new HashSet<string>(existingNames, StringComparer.OrdinalIgnoreCase);
        return nameList.Where(n => existingSet.Contains(n)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, bool replaceExisting = false)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();

        var existingSongs = await db.Songs
            .Where(s => s.OrganizationId == organizationId)
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
            db.Songs.Remove(song);
            await db.SaveChangesAsync();
            songsById.Remove(id);
            RebuildIndex();
        }
    }

    public async Task UpdateSongAsync(string id, string name, string? author)
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();
        var song = await db.Songs.FindAsync(id);
        if (song is null) return;

        song.Name = name;
        song.Author = author;
        await db.SaveChangesAsync();

        if (songsById.TryGetValue(id, out var existing))
        {
            songsById[id] = existing with { Name = name, Author = author };
            RebuildIndex();
        }
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
