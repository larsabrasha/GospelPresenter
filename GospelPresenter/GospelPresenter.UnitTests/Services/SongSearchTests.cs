using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class SongSearchTests
{
    private static Song MakeSong(string name, string? author, params string[] parts) =>
        new(Guid.NewGuid().ToString(), name, author, null, null, null,
            parts.Select(p => new SongPart(null, p)).ToList());

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
    public void EmptyQuery_ReturnsAllSongs()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("");

        result.Count.ShouldBe(4);
    }

    [Fact]
    public void WhitespaceQuery_ReturnsAllSongs()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("   ");

        result.Count.ShouldBe(4);
    }

    [Fact]
    public void TitleMatch_ReturnsCorrectSong()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("Majestät");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void TitleMatch_RankedFirst()
    {
        var service = CreateService(AllSongs);

        // "Gud" appears in title of "Vi vill se Gud" and in text of others
        var result = service.Search("Gud");

        result[0].Name.ShouldBe("Vi vill se Gud");
    }

    [Fact]
    public void PartialTitleMatch_Works()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("Maj");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void FirstPartMatch_RankedBeforeOtherParts()
    {
        var service = CreateService(AllSongs);

        // "saligt" is in first part of "Det är saligt" and not in title
        var result = service.Search("saligt");

        result[0].Name.ShouldBe("Det är saligt");
    }

    [Fact]
    public void TextSearch_FindsInLaterParts()
    {
        var service = CreateService(AllSongs);

        // "knä" only in second part of Majestät
        var result = service.Search("knä");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void MultipleTerms_AllMatch()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("kung Jesus");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void MultipleTerms_PartialMatch_StillReturnsResults()
    {
        var service = CreateService(AllSongs);

        // "Majestät" matches title, "nonexistent" matches nothing
        var result = service.Search("Majestät nonexistent");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void AllTermsMatch_RankedHigherThanPartialMatch()
    {
        var service = CreateService(AllSongs);

        // "Gud" + "saligt" both match "Det är saligt"
        // "Gud" alone matches several songs
        var result = service.Search("Gud saligt");

        result[0].Name.ShouldBe("Det är saligt");
    }

    [Fact]
    public void CaseInsensitive()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("majestät");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }

    [Fact]
    public void NoMatch_ReturnsEmpty()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("xyznonexistent");

        result.Count.ShouldBe(0);
    }

    [Fact]
    public void TitleStartsWith_RankedHigher()
    {
        var service = CreateService(AllSongs);

        // Both "Det är saligt" and "Vi vill se Gud" have "vill" in text,
        // but "Vi vill se Gud" starts with "vi"
        var result = service.Search("vi vill");

        result[0].Name.ShouldBe("Vi vill se Gud");
    }

    [Fact]
    public void AuthorSearch_Works()
    {
        var service = CreateService(AllSongs);

        var result = service.Search("Honningdal");

        result.Count.ShouldBeGreaterThan(0);
        result[0].Name.ShouldBe("Majestät");
    }
}
