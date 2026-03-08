using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public interface ISongService
{
    IReadOnlyList<Song> Songs { get; }
    Song? GetSongById(string id);
    IReadOnlyList<Song> Search(string query);
    void LoadSongs(string songsPath);
}

public class SongService : ISongService
{
    private readonly Dictionary<string, Song> songsById = new();
    private List<Song> songsSorted = [];
    private List<SongSearchEntry> searchIndex = [];

    public IReadOnlyList<Song> Songs => songsSorted;

    public void LoadSongs(string songsPath)
    {
        var files = Directory.GetFiles(songsPath, "*.pro", SearchOption.AllDirectories);
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var file in files)
        {
            var song = ProPresenterParser.ParseFile(file);
            if (song is null) continue;

            if (!seenNames.Add(song.Name)) continue;

            songsById[song.Id] = song;
        }

        RebuildIndex();
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
                // Bonus if title starts with the term
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

        // Bonus for matching all terms
        if (matchedTerms == terms.Length)
            score += 20;

        // Scale by proportion of matched terms so partial matches still show
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
            song.Parts.Count > 0 ? song.Parts[0].Normalize().ToLowerInvariant() : "",
            $"{song.Name} {song.Author} {string.Join(" ", song.Parts)}".Normalize().ToLowerInvariant()
        )).ToList();
    }

    private record SongSearchEntry(Song Song, string Name, string FirstPart, string AllText);
}
