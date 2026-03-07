using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class VerseSearchTests
{
    private static readonly List<Verse> Verses =
    [
        new("MAT", 3, 14, "v3:14"),
        new("MAT", 3, 15, "v3:15"),
        new("MAT", 3, 16, "v3:16"),
        new("MAT", 3, 17, "v3:17"),
        new("MAT", 4, 1, "v4:1"),
        new("MAT", 4, 2, "v4:2"),
        new("MAT", 4, 3, "v4:3"),
        new("MAT", 5, 1, "v5:1"),
        new("GEN", 1, 1, "gen1:1"),
    ];

    [Fact]
    public void SingleChapter_ReturnsAllVersesInChapter()
    {
        var result = VerseSearch.Search(Verses, "MAT 3").ToList();

        result.Count.ShouldBe(4);
        result.ShouldAllBe(v => v.Chapter == 3);
    }

    [Fact]
    public void SingleVerse_ReturnsExactVerse()
    {
        var result = VerseSearch.Search(Verses, "MAT 3:15").ToList();

        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("v3:15");
    }

    [Fact]
    public void VerseRangeWithinChapter_ReturnsVerseRange()
    {
        // "Matt 3:15-17" → chapter 3, verses 15-17
        var result = VerseSearch.Search(Verses, "MAT 3:15-17").ToList();

        result.Count.ShouldBe(3);
        result[0].VerseNumber.ShouldBe(15);
        result[2].VerseNumber.ShouldBe(17);
    }

    [Fact]
    public void VerseToChapter_ReturnsFromVerseToEndOfChapter()
    {
        // "Matt 3:15-4" → chapter 3 verse 15 through all of chapter 4
        var result = VerseSearch.Search(Verses, "MAT 3:15-4").ToList();

        result.Count.ShouldBe(6);
        result[0].Text.ShouldBe("v3:15");
        result[^1].Text.ShouldBe("v4:3");
    }

    [Fact]
    public void ChapterRange_ReturnsAllVersesInRange()
    {
        // "Matt 3-4" → all of chapters 3 and 4
        var result = VerseSearch.Search(Verses, "MAT 3-4").ToList();

        result.Count.ShouldBe(7);
        result[0].Text.ShouldBe("v3:14");
        result[^1].Text.ShouldBe("v4:3");
    }

    [Fact]
    public void ChapterVerseToChapterVerse_ReturnsExactRange()
    {
        // "Matt 3:16-4:2" → chapter 3 verse 16 through chapter 4 verse 2
        var result = VerseSearch.Search(Verses, "MAT 3:16-4:2").ToList();

        result.Count.ShouldBe(4);
        result[0].Text.ShouldBe("v3:16");
        result[^1].Text.ShouldBe("v4:2");
    }

    [Fact]
    public void BookMatchIsCaseInsensitive()
    {
        var result = VerseSearch.Search(Verses, "mat 3:15").ToList();

        result.Count.ShouldBe(1);
    }

    [Fact]
    public void BookMatchIsPrefixBased()
    {
        // "GE" should match "GEN"
        var result = VerseSearch.Search(Verses, "GE 1:1").ToList();

        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("gen1:1");
    }

    [Theory]
    [InlineData("MAT  3:15")]
    [InlineData("MAT 3 :15")]
    [InlineData("MAT 3: 15")]
    [InlineData("MAT 3 : 15")]
    [InlineData("  MAT   3:15  ")]
    public void ExtraWhitespace_IsNormalized(string query)
    {
        var result = VerseSearch.Search(Verses, query).ToList();

        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("v3:15");
    }

    [Theory]
    [InlineData("MAT 3:15 - 17")]
    [InlineData("MAT 3 :15- 17")]
    [InlineData("MAT 3 : 15 - 17")]
    public void ExtraWhitespaceInRange_IsNormalized(string query)
    {
        var result = VerseSearch.Search(Verses, query).ToList();

        result.Count.ShouldBe(3);
        result[0].VerseNumber.ShouldBe(15);
        result[2].VerseNumber.ShouldBe(17);
    }

    [Theory]
    [InlineData("matt 3:15")]
    [InlineData("matteus 3:15")]
    [InlineData("matteusevangeliet 3:15")]
    [InlineData("Mat 3:15")]
    [InlineData("MATT 3:15")]
    public void SwedishBookNames_ResolveCorrectly(string query)
    {
        var result = VerseSearch.Search(Verses, query).ToList();

        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("v3:15");
    }

    [Theory]
    [InlineData("1 mos 1:1")]
    [InlineData("1:a mos 1:1")]
    [InlineData("första mos 1:1")]
    [InlineData("första moseboken 1:1")]
    [InlineData("genesis 1:1")]
    [InlineData("gen 1:1")]
    public void NumberedBookVariants_ResolveCorrectly(string query)
    {
        var result = VerseSearch.Search(Verses, query).ToList();

        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("gen1:1");
    }

    [Fact]
    public void InvalidQuery_ReturnsEmpty()
    {
        VerseSearch.Search(Verses, "").ShouldBeEmpty();
        VerseSearch.Search(Verses, "MAT abc").ShouldBeEmpty();
    }

    [Fact]
    public void BookOnly_ReturnsAllVersesForBook()
    {
        var result = VerseSearch.Search(Verses, "MAT").ToList();
        result.Count.ShouldBe(8);
    }
}
