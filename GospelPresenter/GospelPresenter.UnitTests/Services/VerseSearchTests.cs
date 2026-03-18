using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class VerseSearchTests
{
    private const string Matthew = "MAT";
    private const string Genesis = "GEN";

    private static readonly List<Verse> Verses =
    [
        new(Matthew, 3, 14, "v3:14"),
        new(Matthew, 3, 15, "v3:15"),
        new(Matthew, 3, 16, "v3:16"),
        new(Matthew, 3, 17, "v3:17"),
        new(Matthew, 4, 1, "v4:1"),
        new(Matthew, 4, 2, "v4:2"),
        new(Matthew, 4, 3, "v4:3"),
        new(Matthew, 5, 1, "v5:1"),
        new(Genesis, 1, 1, "gen1:1"),
    ];

    [Fact]
    public void Search_SingleChapter_ReturnsAllVersesInChapter()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT 3").ToList();

        // Assert
        result.Count.ShouldBe(4);
        result.ShouldAllBe(v => v.Chapter == 3);
    }

    [Fact]
    public void Search_SingleVerse_ReturnsExactVerse()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT 3:15").ToList();

        // Assert
        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("v3:15");
    }

    [Fact]
    public void Search_VerseRangeWithinChapter_ReturnsVerseRange()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT 3:15-17").ToList();

        // Assert
        result.Count.ShouldBe(3);
        result[0].VerseNumber.ShouldBe(15);
        result[2].VerseNumber.ShouldBe(17);
    }

    [Fact]
    public void Search_VerseToChapter_ReturnsFromVerseToEndOfChapter()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT 3:15-4").ToList();

        // Assert
        result.Count.ShouldBe(6);
        result[0].Text.ShouldBe("v3:15");
        result[^1].Text.ShouldBe("v4:3");
    }

    [Fact]
    public void Search_ChapterRange_ReturnsAllVersesInRange()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT 3-4").ToList();

        // Assert
        result.Count.ShouldBe(7);
        result[0].Text.ShouldBe("v3:14");
        result[^1].Text.ShouldBe("v4:3");
    }

    [Fact]
    public void Search_ChapterVerseToChapterVerse_ReturnsExactRange()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT 3:16-4:2").ToList();

        // Assert
        result.Count.ShouldBe(4);
        result[0].Text.ShouldBe("v3:16");
        result[^1].Text.ShouldBe("v4:2");
    }

    [Fact]
    public void Search_LowercaseBookId_MatchesCaseInsensitively()
    {
        // Act
        var result = VerseSearch.Search(Verses, "mat 3:15").ToList();

        // Assert
        result.Count.ShouldBe(1);
    }

    [Fact]
    public void Search_PrefixBookId_MatchesFullBookId()
    {
        // Act
        var result = VerseSearch.Search(Verses, "GE 1:1").ToList();

        // Assert
        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("gen1:1");
    }

    [Theory]
    [InlineData("MAT  3:15")]
    [InlineData("MAT 3 :15")]
    [InlineData("MAT 3: 15")]
    [InlineData("MAT 3 : 15")]
    [InlineData("  MAT   3:15  ")]
    public void Search_ExtraWhitespace_NormalizesAndReturnsCorrectVerse(string query)
    {
        // Act
        var result = VerseSearch.Search(Verses, query).ToList();

        // Assert
        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("v3:15");
    }

    [Theory]
    [InlineData("MAT 3:15 - 17")]
    [InlineData("MAT 3 :15- 17")]
    [InlineData("MAT 3 : 15 - 17")]
    public void Search_ExtraWhitespaceInRange_NormalizesAndReturnsCorrectRange(string query)
    {
        // Act
        var result = VerseSearch.Search(Verses, query).ToList();

        // Assert
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
    public void Search_SwedishBookName_ResolvesToCorrectBook(string query)
    {
        // Act
        var result = VerseSearch.Search(Verses, query).ToList();

        // Assert
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
    public void Search_NumberedBookVariant_ResolvesToCorrectBook(string query)
    {
        // Act
        var result = VerseSearch.Search(Verses, query).ToList();

        // Assert
        result.Count.ShouldBe(1);
        result[0].Text.ShouldBe("gen1:1");
    }

    [Fact]
    public void Search_EmptyQuery_ReturnsEmpty()
    {
        // Act
        var result = VerseSearch.Search(Verses, "");

        // Assert
        result.ShouldBeEmpty();
    }

    [Fact]
    public void Search_InvalidChapterFormat_ReturnsEmpty()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT abc");

        // Assert
        result.ShouldBeEmpty();
    }

    [Fact]
    public void Search_BookOnly_ReturnsAllVersesForBook()
    {
        // Act
        var result = VerseSearch.Search(Verses, "MAT").ToList();

        // Assert
        result.Count.ShouldBe(8);
    }
}
