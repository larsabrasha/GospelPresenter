using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class BibleConverterTests
{
    private static readonly string ResourceDir = Path.Combine(AppContext.BaseDirectory, "Resources");

    [Fact]
    public void ConvertUsxToJson_ParsesNormalParagraphs()
    {
        var verses = ConvertAndDeserialize();

        var v1 = verses.Single(v => v is { BookId: "TST", Chapter: 1, VerseNumber: 1 });
        v1.Text.ShouldBe("In the beginning there was a test.");
    }

    [Fact]
    public void ConvertUsxToJson_ParsesCharElements()
    {
        var verses = ConvertAndDeserialize();

        // <char style="qt"> content should be included in verse text
        var v3 = verses.Single(v => v is { BookId: "TST", Chapter: 1, VerseNumber: 3 });
        v3.Text.ShouldContain("a quoted phrase");
    }

    [Fact]
    public void ConvertUsxToJson_ExcludesFootnotes()
    {
        var verses = ConvertAndDeserialize();

        var v4 = verses.Single(v => v is { BookId: "TST", Chapter: 1, VerseNumber: 4 });
        v4.Text.ShouldNotContain("footnote that should be excluded");
        v4.Text.ShouldContain("footnote nearby");
    }

    [Fact]
    public void ConvertUsxToJson_HandlesVerseRanges()
    {
        var verses = ConvertAndDeserialize();

        // "5-6" should be parsed as verse 5
        var v5 = verses.Single(v => v is { BookId: "TST", Chapter: 1, VerseNumber: 5 });
        v5.Text.ShouldContain("verse range spanning two verses");
    }

    [Fact]
    public void ConvertUsxToJson_ParsesPoetryParagraphs()
    {
        var verses = ConvertAndDeserialize();

        // q1 paragraph with verse marker
        var v2 = verses.Single(v => v is { BookId: "TST", Chapter: 2, VerseNumber: 2 });
        v2.Text.ShouldContain("line of poetry");
        // q2 continuation should be part of the same verse
        v2.Text.ShouldContain("continues on a second line");
    }

    [Fact]
    public void ConvertUsxToJson_ParsesNestedCharElements()
    {
        var verses = ConvertAndDeserialize();

        var v3 = verses.Single(v => v is { BookId: "TST", Chapter: 2, VerseNumber: 3 });
        v3.Text.ShouldContain("deeply nested");
        v3.Text.ShouldContain("quote");
    }

    [Fact]
    public void ConvertUsxToJson_HandlesContinuationText()
    {
        var verses = ConvertAndDeserialize();

        // Text at the start of a <para> before any <verse> belongs to the previous verse
        var v1 = verses.Single(v => v is { BookId: "TST", Chapter: 3, VerseNumber: 1 });
        v1.Text.ShouldContain("First verse of chapter three");
        v1.Text.ShouldContain("Continuation text for verse one");
    }

    [Fact]
    public void ConvertUsxToJson_SkipsHeadingsAndMetadata()
    {
        var verses = ConvertAndDeserialize();

        verses.ShouldAllBe(v => !v.Text.Contains("First Section"));
        verses.ShouldAllBe(v => !v.Text.Contains("Test Book"));
        verses.ShouldAllBe(v => !v.Text.Contains("Poetry Section"));
    }

    [Fact]
    public void ConvertUsxToJson_ProducesCorrectChapterStructure()
    {
        var verses = ConvertAndDeserialize();

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
