using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class ProPresenterParserTests
{
    private const string TestUserId = "test-user";
    private const string TestAuthor = "Test Author";
    private const string TestPublisher = "Test Publisher";
    private const string TestCcliNumber = "12345";
    private static readonly CallerContext TestCaller = new(TestUserId, UserRole.Admin, "");

    private static Song[] CreateTestSongs() =>
    [
        new Song("1", "Ett utvalt folk förkunnar", TestAuthor, null, null, null,
        [
            new SongPart("Verse 1", "Du har ett utvalt folk som förkunnar din ära"),
            new SongPart("Chorus", "Vi prisar dig, vi tillber dig")
        ]),
        new Song("2", "Välsignelse över dig", TestAuthor, null, null, null,
        [
            new SongPart("Verse 1", "Välsignelse över dig som tror"),
            new SongPart("Verse 2", "Hans nåd är ny varje morgon")
        ]),
        new Song("3", "Stor är din trofasthet", null, TestPublisher, null, TestCcliNumber,
        [
            new SongPart("Verse 1", "Stor är din trofasthet, o Gud min Fader")
        ])
    ];

    [Fact]
    public void SearchByOrganization_SwedishWord_FindsMatchingSongs()
    {
        // Arrange
        var service = new TestSongService(CreateTestSongs());

        // Act
        var results = service.SearchByOrganization("förkunnar", "", TestCaller);

        // Assert
        results.Count.ShouldBeGreaterThan(0);
    }

    [Fact]
    public void SearchByOrganization_SwedishCharacters_MatchesCorrectSong()
    {
        // Arrange
        var service = new TestSongService(CreateTestSongs());

        // Act
        var results = service.SearchByOrganization("välsignel", "", TestCaller);

        // Assert
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
