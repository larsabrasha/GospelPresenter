using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Author and Year are optional on a song, and a church that imports two hundred ProPresenter files
/// will have plenty with neither. Sorting must not reward that: a blank field says nothing about
/// where the song belongs, so those rows sink instead of filling the first screen and burying the
/// songs the user actually sorted for.
/// </summary>
public class SongSortingTests
{
    private static Song SongNamed(string name, string? author = null, int? year = null) =>
        new(Id: name, Name: name, Author: author, Publisher: null, Year: year, Ccli: null,
            Parts: [], Arrangements: []);

    [Fact]
    public void NameAscIsTheDefaultForAnythingUnrecognised()
    {
        var songs = new[] { SongNamed("Be Thou My Vision"), SongNamed("Amazing Grace") };

        songs.Sort((SongSortOrder)999).Select(s => s.Name)
            .ShouldBe(["Amazing Grace", "Be Thou My Vision"]);
    }

    [Fact]
    public void NameSortsIgnoringCase()
    {
        var songs = new[] { SongNamed("bright morning"), SongNamed("Amazing Grace") };

        songs.Sort(SongSortOrder.NameAsc).Select(s => s.Name)
            .ShouldBe(["Amazing Grace", "bright morning"]);
    }

    [Fact]
    public void NameDescReversesIt()
    {
        var songs = new[] { SongNamed("Amazing Grace"), SongNamed("Be Thou My Vision") };

        songs.Sort(SongSortOrder.NameDesc).Select(s => s.Name)
            .ShouldBe(["Be Thou My Vision", "Amazing Grace"]);
    }

    [Fact]
    public void SongsWithoutAnAuthorSinkToTheBottom()
    {
        var songs = new[]
        {
            SongNamed("Unknown One"),
            SongNamed("Amazing Grace", author: "John Newton"),
            SongNamed("Unknown Two", author: "  "),
            SongNamed("Be Thou My Vision", author: "Dallán Forgaill")
        };

        songs.Sort(SongSortOrder.Author).Select(s => s.Name)
            .ShouldBe(["Be Thou My Vision", "Amazing Grace", "Unknown One", "Unknown Two"]);
    }

    [Fact]
    public void YearSortsNewestFirstAndUndatedSongsLast()
    {
        var songs = new[]
        {
            SongNamed("Undated"),
            SongNamed("Older", year: 1779),
            SongNamed("Newer", year: 1990)
        };

        songs.Sort(SongSortOrder.Year).Select(s => s.Name)
            .ShouldBe(["Newer", "Older", "Undated"]);
    }

    [Fact]
    public void NameBreaksEveryTieSoTheOrderIsStable()
    {
        var songs = new[]
        {
            SongNamed("Zion", year: 1900),
            SongNamed("Advent", year: 1900)
        };

        // Without the tie-break the order would follow however the cache happened to load them,
        // which shifts under the user for no visible reason.
        songs.Sort(SongSortOrder.Year).Select(s => s.Name).ShouldBe(["Advent", "Zion"]);
    }
}
