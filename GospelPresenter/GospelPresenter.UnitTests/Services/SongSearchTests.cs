using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class SongSearchTests
{
    private const string TestOrgId = "test-org";
    private static readonly CallerContext TestCaller = new("test-user", UserRole.Admin, TestOrgId);

    private static Song MakeSong(string name, string? author, params string[] parts) =>
        new(Guid.NewGuid().ToString(), name, author, null, null, null,
            parts.Select(p => new SongPart(null, p)).ToList(), TestOrgId);

    private static ISongService CreateService(params Song[] songs)
    {
        var service = new TestSongService(songs);
        return service;
    }

    private class TestSongService : SongService
    {
        public TestSongService(Song[] songs) : base(null!)
        {
            LoadTestSongs(songs);
        }
    }

    private static readonly Song Majestat = MakeSong("Majestät", "Jan Honningdal",
        "Majestät, Konung i evighet.\nJord och hav och himmel,\när skapat utav Dig.",
        "Vi vill upphöja Dig kung Jesus\nvarje knä ska böjas inför Dig.");

    private static readonly Song HogstAvAllt = MakeSong("Högst av allt", "Bengt Johansson",
        "Högt över världen och mänsklig makt\nÖver allt skapat och hela jordens prakt",
        "Men du dog ensam och fördömd\nen korsfäst Gud och i gravens mörker gömd");

    private static readonly Song DetArSaligt = MakeSong("Det är saligt", null,
        "Det är saligt på Jesus få tro\noch att vara Guds barn blott av nåd.",
        "Gud ske lov, Gud ske tack\natt hans salighet även är min.");

    private static readonly Song ViVillSeGud = MakeSong("Vi vill se Gud", null,
        "Glödhet är Guds närhet,\nHans härlighet brinner över oss",
        "Vi vill se Gud, vi vill se Gud i detta land");

    private static readonly Song[] AllSongs = [Majestat, HogstAvAllt, DetArSaligt, ViVillSeGud];

    [Fact]
    public void SearchByOrganization_EmptyQuery_ReturnsAllSongs()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(4);
    }

    [Fact]
    public void SearchByOrganization_WhitespaceQuery_ReturnsAllSongs()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("   ", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(4);
    }

    [Fact]
    public void SearchByOrganization_ExactTitle_ReturnsMatchingSong()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Majestät", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_TitleMatch_RankedFirst()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Gud", TestOrgId, TestCaller);

        // Assert
        result[0].Name.ShouldBe("Vi vill se Gud");
    }

    [Fact]
    public void SearchByOrganization_PartialTitle_ReturnsMatchingSong()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Maj", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_FirstPartMatch_RankedBeforeOtherParts()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("saligt", TestOrgId, TestCaller);

        // Assert
        result[0].Name.ShouldBe("Det är saligt");
    }

    [Fact]
    public void SearchByOrganization_TextInLaterPart_FindsCorrectSong()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("knä", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_MultipleTerms_ReturnsMatchingAllTerms()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("kung Jesus", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_PartialTermMatch_StillReturnsResults()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Majestät nonexistent", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_AllTermsMatch_RankedHigherThanPartialMatch()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Gud saligt", TestOrgId, TestCaller);

        // Assert
        result[0].Name.ShouldBe("Det är saligt");
    }

    [Fact]
    public void SearchByOrganization_LowercaseQuery_MatchesCaseInsensitively()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("majestät", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_NonexistentTerm_ReturnsEmpty()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("xyznonexistent", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(0);
    }

    [Fact]
    public void SearchByOrganization_TitleStartsWith_RankedHigherThanTextMatch()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("vi vill", TestOrgId, TestCaller);

        // Assert
        result[0].Name.ShouldBe("Vi vill se Gud");
    }

    [Fact]
    public void SearchByOrganization_AuthorName_FindsCorrectSong()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Honningdal", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }
}
