using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class UsfmParserTests
{
    private const string TestBookId = "TST";
    private static readonly string ResourceDir = Path.Combine(AppContext.BaseDirectory, "Resources");

    [Fact]
    public void ParseBook_BookCode_ExtractedFromIdMarker()
    {
        var book = ParseTestBook();

        book.Code.ShouldBe(TestBookId);
    }

    [Fact]
    public void ParseBook_NormalParagraphs_ParsesVerseText()
    {
        var verses = ParseTestVerses();

        var v1 = verses.Single(v => v is { Chapter: 1, VerseNumber: 1 });

        v1.Text.ShouldBe("In the beginning there was a test.");
    }

    [Fact]
    public void ParseBook_CharElements_IncludesQuotedText()
    {
        var verses = ParseTestVerses();

        var v3 = verses.Single(v => v is { Chapter: 1, VerseNumber: 3 });

        v3.Text.ShouldContain("a quoted phrase");
    }

    [Fact]
    public void ParseBook_Footnotes_ExcludesFootnoteText()
    {
        var verses = ParseTestVerses();

        var v4 = verses.Single(v => v is { Chapter: 1, VerseNumber: 4 });

        v4.Text.ShouldNotContain("footnote that should be excluded");
        v4.Text.ShouldContain("footnote nearby");
    }

    [Fact]
    public void ParseBook_VerseRange_ParsesAsFirstVerseNumber()
    {
        var verses = ParseTestVerses();

        var v5 = verses.Single(v => v is { Chapter: 1, VerseNumber: 5 });

        v5.Text.ShouldContain("verse range spanning two verses");
    }

    [Fact]
    public void ParseBook_PoetryParagraphs_CombinesLinesIntoSingleVerse()
    {
        var verses = ParseTestVerses();

        var v2 = verses.Single(v => v is { Chapter: 2, VerseNumber: 2 });

        v2.Text.ShouldContain("line of poetry");
        v2.Text.ShouldContain("continues on a second line");
    }

    [Fact]
    public void ParseBook_NestedCharElements_ExtractsAllText()
    {
        var verses = ParseTestVerses();

        var v3 = verses.Single(v => v is { Chapter: 2, VerseNumber: 3 });

        v3.Text.ShouldContain("deeply nested");
        v3.Text.ShouldContain("quote");
    }

    [Fact]
    public void ParseBook_ContinuationText_AppendsToPreviousVerse()
    {
        var verses = ParseTestVerses();

        var v1 = verses.Single(v => v is { Chapter: 3, VerseNumber: 1 });

        v1.Text.ShouldContain("First verse of chapter three");
        v1.Text.ShouldContain("Continuation text for verse one");
    }

    [Fact]
    public void ParseBook_HeadingsAndMetadata_ExcludedFromVerses()
    {
        var verses = ParseTestVerses();

        verses.ShouldAllBe(v => !v.Text.Contains("First Section"));
        verses.ShouldAllBe(v => !v.Text.Contains("Test Book"));
        verses.ShouldAllBe(v => !v.Text.Contains("Poetry Section"));
    }

    [Fact]
    public void ParseBook_MultipleChapters_ProducesCorrectVerseCounts()
    {
        var verses = ParseTestVerses();

        verses.Count(v => v.Chapter == 1).ShouldBe(5);
        verses.Count(v => v.Chapter == 2).ShouldBe(4);
        verses.Count(v => v.Chapter == 3).ShouldBe(2);
    }

    [Fact]
    public void ParseBook_CrossReferences_ExcludedFromVerseText()
    {
        var usfm = @"\id TST
\c 1
\p
\v 1 Some text \x + \xo 1:1 \xt Gen 1:1\x* and more text.";

        var book = UsfmParser.ParseBook(usfm);
        var verse = book.Chapters[0].Verses[0];

        verse.Text.ShouldContain("Some text");
        verse.Text.ShouldContain("and more text");
        verse.Text.ShouldNotContain("Gen 1:1");
    }

    private static BibleBook ParseTestBook()
    {
        var usfm = File.ReadAllText(Path.Combine(ResourceDir, "TST.usfm"));
        return UsfmParser.ParseBook(usfm);
    }

    private static List<Verse> ParseTestVerses()
    {
        var book = ParseTestBook();
        return book.Chapters
            .SelectMany(ch => ch.Verses.Select(v => new Verse(book.Code, ch.Number, v.Number, v.Text)))
            .ToList();
    }
}
