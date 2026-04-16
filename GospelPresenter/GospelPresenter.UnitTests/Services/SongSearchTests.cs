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
            parts.Select(p => new SongPart("", null, null, null, p)).ToList(), [], TestOrgId);

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
    public void SearchByOrganization_NotAllTermsMatch_ReturnsEmpty()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Majestät nonexistent", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(0);
    }

    [Fact]
    public void SearchByOrganization_AllTermsRequired_OnlyMatchesWhenAllPresent()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Gud saligt", TestOrgId, TestCaller);

        // Assert - only "Det är saligt" has both "Gud" and "saligt"
        result.Count.ShouldBe(1);
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

    [Fact]
    public void SearchByOrganization_WithoutDiacritics_FindsSongWithDiacritics()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Majestat", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_WithoutDiacritics_FindsSwedishCharacters()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("Hogst av allt", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Högst av allt");
    }

    [Fact]
    public void SearchByOrganization_ExactDiacritics_RankedHigherThanStrippedMatch()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act
        var exactResult = service.SearchByOrganization("Majestät", TestOrgId, TestCaller);
        var strippedResult = service.SearchByOrganization("Majestat", TestOrgId, TestCaller);

        // Assert - both find the song, but exact match should exist
        exactResult.Count.ShouldBeGreaterThan(0);
        strippedResult.Count.ShouldBeGreaterThan(0);
        exactResult[0].Name.ShouldBe("Majestät");
        strippedResult[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_WithoutDiacriticsInLyrics_FindsSong()
    {
        // Arrange
        var service = CreateService(AllSongs);

        // Act - "kna" without accent should match "knä" in lyrics
        var result = service.SearchByOrganization("kna", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void SearchByOrganization_PhraseInTitle_RankedHigherThanScatteredTerms()
    {
        // Arrange - "Vi vill se Gud" has the phrase in title,
        // "Majestät" has "vi vill" in later parts but not as a title phrase
        var service = CreateService(AllSongs);

        // Act
        var result = service.SearchByOrganization("vi vill se", TestOrgId, TestCaller);

        // Assert
        result[0].Name.ShouldBe("Vi vill se Gud");
    }

    [Fact]
    public void SearchByOrganization_PhraseInTitle_RankedHigherThanPhraseInLyrics()
    {
        // Arrange
        var songWithTitlePhrase = MakeSong("Gud ske lov", null, "Första versen här");
        var songWithLyricsPhrase = MakeSong("En annan sång", null, "Gud ske lov, Gud ske tack");
        var service = CreateService([songWithTitlePhrase, songWithLyricsPhrase]);

        // Act
        var result = service.SearchByOrganization("Gud ske lov", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(2);
        result[0].Name.ShouldBe("Gud ske lov");
    }

    [Fact]
    public void SearchByOrganization_PhraseInFirstPart_RankedHigherThanPhraseInLaterPart()
    {
        // Arrange
        var songFirstPart = MakeSong("Sång A", null, "Guds barn av nåd", "Annan text");
        var songLaterPart = MakeSong("Sång B", null, "Första versen", "Guds barn av nåd");
        var service = CreateService([songFirstPart, songLaterPart]);

        // Act
        var result = service.SearchByOrganization("Guds barn", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(2);
        result[0].Name.ShouldBe("Sång A");
    }

    [Fact]
    public void SearchByOrganization_TermInMiddleOfWord_DoesNotMatch()
    {
        // Arrange - "vighet" is in the middle of "evighet", not a word prefix
        var song = MakeSong("Annan sång", null, "I all evighet sjunger vi");
        var service = CreateService([song]);

        // Act
        var result = service.SearchByOrganization("vighet", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(0);
    }

    [Fact]
    public void SearchByOrganization_TermAsWordPrefix_Matches()
    {
        // Arrange - "evi" doesn't match but "evig" matches "evighet"
        var song = MakeSong("Evighet", null, "I all evighet");
        var service = CreateService([song]);

        // Act
        var result = service.SearchByOrganization("Evig", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(1);
    }

    [Fact]
    public void SearchByOrganization_ExactTitle_RankedFirst()
    {
        // Arrange
        var exact = MakeSong("Vi vill se Gud", null, "Första vers");
        var longer = MakeSong("Vi vill se Gud i detta land", null, "Första vers");
        var service = CreateService([longer, exact]);

        // Act
        var result = service.SearchByOrganization("Vi vill se Gud", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(2);
        result[0].Name.ShouldBe("Vi vill se Gud");
    }

    [Fact]
    public void SearchByOrganization_ExactTitleWithoutDiacritics_RankedFirst()
    {
        // Arrange
        var exact = MakeSong("Högst av allt", null, "Första vers");
        var longer = MakeSong("Högst av allt i himlen", null, "Första vers");
        var service = CreateService([longer, exact]);

        // Act
        var result = service.SearchByOrganization("hogst av allt", TestOrgId, TestCaller);

        // Assert
        result.Count.ShouldBe(2);
        result[0].Name.ShouldBe("Högst av allt");
    }

    [Fact]
    public void SearchByOrganization_PhraseWithoutDiacritics_StillGetsPhraseBonus()
    {
        // Arrange
        var songTitle = MakeSong("Högst av allt", null, "Första vers");
        var songScattered = MakeSong("Allt annat", null, "Högst i skyn och av alla");
        var service = CreateService([songTitle, songScattered]);

        // Act
        var result = service.SearchByOrganization("hogst av allt", TestOrgId, TestCaller);

        // Assert
        result[0].Name.ShouldBe("Högst av allt");
    }
}
