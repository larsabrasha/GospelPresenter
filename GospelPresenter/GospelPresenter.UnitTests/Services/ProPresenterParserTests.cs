using GospelPresenter.Shared.Services;
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
        var allText = string.Join(" ", song.Parts);
        allText.ShouldContain("förkunnar", Case.Insensitive);
    }

    [Fact]
    public void Search_SwedishWord_FindsResults()
    {
        if (SongsPath is null) return;

        var service = new SongService();
        service.LoadSongs(SongsPath);

        service.Songs.Count.ShouldBeGreaterThan(100, $"Only {service.Songs.Count} songs loaded");

        var results = service.Search("förkunnar");
        results.Count.ShouldBeGreaterThan(0);
    }
}
