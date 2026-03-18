using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class BibleConverterTests
{
    private const string TestBookId = "TST";
    private static readonly string ResourceDir = Path.Combine(AppContext.BaseDirectory, "Resources");

    [Fact]
    public void ConvertUsxToJson_NormalParagraphs_ParsesVerseText()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v1 = verses.Single(v => v is { BookId: TestBookId, Chapter: 1, VerseNumber: 1 });

        // Assert
        v1.Text.ShouldBe("In the beginning there was a test.");
    }

    [Fact]
    public void ConvertUsxToJson_CharElements_IncludesQuotedText()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v3 = verses.Single(v => v is { BookId: TestBookId, Chapter: 1, VerseNumber: 3 });

        // Assert
        v3.Text.ShouldContain("a quoted phrase");
    }

    [Fact]
    public void ConvertUsxToJson_Footnotes_ExcludesFootnoteText()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v4 = verses.Single(v => v is { BookId: TestBookId, Chapter: 1, VerseNumber: 4 });

        // Assert
        v4.Text.ShouldNotContain("footnote that should be excluded");
        v4.Text.ShouldContain("footnote nearby");
    }

    [Fact]
    public void ConvertUsxToJson_VerseRange_ParsesAsFirstVerseNumber()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v5 = verses.Single(v => v is { BookId: TestBookId, Chapter: 1, VerseNumber: 5 });

        // Assert
        v5.Text.ShouldContain("verse range spanning two verses");
    }

    [Fact]
    public void ConvertUsxToJson_PoetryParagraphs_CombinesLinesIntoSingleVerse()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v2 = verses.Single(v => v is { BookId: TestBookId, Chapter: 2, VerseNumber: 2 });

        // Assert
        v2.Text.ShouldContain("line of poetry");
        v2.Text.ShouldContain("continues on a second line");
    }

    [Fact]
    public void ConvertUsxToJson_NestedCharElements_ExtractsAllText()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v3 = verses.Single(v => v is { BookId: TestBookId, Chapter: 2, VerseNumber: 3 });

        // Assert
        v3.Text.ShouldContain("deeply nested");
        v3.Text.ShouldContain("quote");
    }

    [Fact]
    public void ConvertUsxToJson_ContinuationText_AppendsToPreviousVerse()
    {
        // Arrange
        var verses = ConvertAndDeserialize();

        // Act
        var v1 = verses.Single(v => v is { BookId: TestBookId, Chapter: 3, VerseNumber: 1 });

        // Assert
        v1.Text.ShouldContain("First verse of chapter three");
        v1.Text.ShouldContain("Continuation text for verse one");
    }

    [Fact]
    public void ConvertUsxToJson_HeadingsAndMetadata_ExcludedFromVerses()
    {
        // Arrange & Act
        var verses = ConvertAndDeserialize();

        // Assert
        verses.ShouldAllBe(v => !v.Text.Contains("First Section"));
        verses.ShouldAllBe(v => !v.Text.Contains("Test Book"));
        verses.ShouldAllBe(v => !v.Text.Contains("Poetry Section"));
    }

    [Fact]
    public void ConvertUsxToJson_MultipleChapters_ProducesCorrectVerseCounts()
    {
        // Arrange & Act
        var verses = ConvertAndDeserialize();

        // Assert
        verses.Count(v => v.Chapter == 1).ShouldBe(5);
        verses.Count(v => v.Chapter == 2).ShouldBe(4);
        verses.Count(v => v.Chapter == 3).ShouldBe(2);
    }

    private static List<Verse> ConvertAndDeserialize()
    {
        var outputFile = Path.GetTempFileName();
        try
        {
            BibleConverter.ConvertUsxToJson(ResourceDir, outputFile);
            var json = File.ReadAllText(outputFile);
            var verses = System.Text.Json.JsonSerializer.Deserialize<List<Verse>>(json);
            verses.ShouldNotBeNull();
            return verses;
        }
        finally
        {
            File.Delete(outputFile);
        }
    }
}
