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

    public IReadOnlyList<Song> Songs => songsSorted;

    public void LoadSongs(string songsPath)
    {
        var files = Directory.GetFiles(songsPath, "*.pro", SearchOption.AllDirectories);

        foreach (var file in files)
        {
            var song = ProPresenterParser.ParseFile(file);
            if (song is null) continue;

            // Skip duplicates by name (some files have -1 suffix)
            if (songsById.Values.Any(s => s.Name == song.Name)) continue;

            songsById[song.Id] = song;
        }

        songsSorted = songsById.Values
            .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    public Song? GetSongById(string id)
    {
        return songsById.GetValueOrDefault(id);
    }

    public IReadOnlyList<Song> Search(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return songsSorted;

        var terms = query.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return songsSorted
            .Where(song =>
            {
                var searchText = $"{song.Name} {song.Author} {string.Join(" ", song.Parts)}".ToLowerInvariant();
                return terms.All(term => searchText.Contains(term));
            })
            .ToList();
    }
}
