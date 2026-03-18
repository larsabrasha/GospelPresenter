using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class ProPresenterParserTests
{
    private static readonly CallerContext TestCaller = new("test-user", UserRole.Admin, "");

    private static Song[] CreateTestSongs() =>
    [
        new Song("1", "Ett utvalt folk förkunnar", "Test Author", null, null, null,
        [
            new SongPart("Verse 1", "Du har ett utvalt folk som förkunnar din ära"),
            new SongPart("Chorus", "Vi prisar dig, vi tillber dig")
        ]),
        new Song("2", "Välsignelse över dig", "Test Author", null, null, null,
        [
            new SongPart("Verse 1", "Välsignelse över dig som tror"),
            new SongPart("Verse 2", "Hans nåd är ny varje morgon")
        ]),
        new Song("3", "Stor är din trofasthet", null, "Test Publisher", null, "12345",
        [
            new SongPart("Verse 1", "Stor är din trofasthet, o Gud min Fader")
        ])
    ];

    [Fact]
    public void Search_SwedishWord_FindsResults()
    {
        var service = new TestSongService(CreateTestSongs());

        var results = service.SearchByOrganization("förkunnar", "", TestCaller);

        results.Count.ShouldBeGreaterThan(0);
    }

    [Fact]
    public void Search_SwedishCharacters_MatchesCorrectly()
    {
        var service = new TestSongService(CreateTestSongs());

        var results = service.SearchByOrganization("välsignel", "", TestCaller);

        results.Count.ShouldBeGreaterThan(0);
        results.ShouldContain(s => s.Name.Contains("lsignelse"));
    }

    private class TestSongService : SongService
    {
        public TestSongService(Song[] songs) : base(null!)
        {
            LoadTestSongs(songs);
        }
    }
}
