using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class ProPresenterParserTests
{
    private static readonly string? SongsPath = FindSongsPath();

    private static string? FindSongsPath()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "songs");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return null;
    }

    [Fact]
    public void ParseFile_SwedishCharacters_DecodedCorrectly()
    {
        if (SongsPath is null) return;

        var songFile = Directory.GetFiles(SongsPath, "*.pro", SearchOption.AllDirectories)
            .FirstOrDefault(f => f.Contains("utvalt"));
        if (songFile is null) return;

        var song = ProPresenterParser.ParseFile(songFile);

        song.ShouldNotBeNull();
        var allText = string.Join(" ", song.Parts.Select(p => p.Content));
        allText.ShouldContain("förkunnar", Case.Insensitive);
    }

    [Fact]
    public void Search_SwedishWord_FindsResults()
    {
        if (SongsPath is null) return;

        var songs = LoadSongsFromDisk();
        songs.Count.ShouldBeGreaterThan(100, $"Only {songs.Count} songs loaded");

        var service = new TestSongService(songs.ToArray());
        var results = service.Search("förkunnar");
        results.Count.ShouldBeGreaterThan(0);
    }

    [Fact]
    public void Search_NfdNormalizedTitle_MatchesNfcQuery()
    {
        if (SongsPath is null) return;

        var songs = LoadSongsFromDisk();
        var service = new TestSongService(songs.ToArray());

        var results = service.Search("välsignel");
        results.Count.ShouldBeGreaterThan(0);
        results.ShouldContain(s => s.Name.Contains("lsignelse"));
    }

    private static List<Song> LoadSongsFromDisk()
    {
        var files = Directory.GetFiles(SongsPath!, "*.pro", SearchOption.AllDirectories);
        var songs = new List<Song>();
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var file in files)
        {
            var song = ProPresenterParser.ParseFile(file);
            if (song is null) continue;
            if (!seenNames.Add(song.Name)) continue;
            songs.Add(song);
        }

        return songs;
    }

    private class TestSongService : SongService
    {
        public TestSongService(Song[] songs) : base(null!)
        {
            LoadTestSongs(songs);
        }
    }
}
