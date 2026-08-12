using System.Net;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class BibleTextServiceTests
{
    private const string BookId = "JHN";
    private const int Chapter = 3;
    private const int VerseNumber = 16;
    private const string ScriptPayload = "<script>alert('xss')</script>";
    private const string PlainVerse = "For God so loved the world";
    private const string SlideWrapperStart = "<div class=\"text-left\">";
    private const string SlideWrapperEnd = "</div>";

    private readonly BibleTextService service = new();

    [Fact]
    public void Create_WithMarkupInVerseText_EncodesItSoItCannotExecute()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith($"Truly {ScriptPayload} I say") };

        // Act
        var result = service.Create(verses);

        // Assert
        var html = Joined(result);
        html.ShouldNotContain("<script");
        html.ShouldContain("&lt;script&gt;");
    }

    [Fact]
    public void Create_WithAmpersandInVerseText_EncodesItExactlyOnce()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith("Alpha & Omega") };

        // Act
        var result = service.Create(verses);

        // Assert
        var html = Joined(result);
        html.ShouldContain("Alpha &amp; Omega");
        html.ShouldNotContain("&amp;amp;");
    }

    [Fact]
    public void Create_WithQuotesInVerseText_EncodesThemSoTheyCannotCloseAnAttribute()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith("He said \"peace\" to them") };

        // Act
        var result = service.Create(verses);

        // Assert
        var html = Joined(result);
        html.ShouldContain("&quot;peace&quot;");
        html.ShouldNotContain("\"peace\"");
    }

    [Fact]
    public void Create_ByDefault_KeepsTheIntentionalSlideMarkup()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith(PlainVerse) };

        // Act
        var result = service.Create(verses);

        // Assert
        var html = Joined(result);
        html.ShouldContain(SlideWrapperStart);
        html.ShouldContain($"<sup class=\"opacity-40\">{VerseNumber}</sup>");
    }

    [Fact]
    public void Create_WithPlainVerseText_LeavesTheWordsReadable()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith(PlainVerse) };

        // Act
        var result = service.Create(verses);

        // Assert
        Joined(result).ShouldContain(PlainVerse);
    }

    [Fact]
    public void Create_WithLongTextContainingMarkup_SplitsIntoWellFormedSlides()
    {
        // Arrange -- comfortably longer than one slide, with a payload in the middle
        var longText = string.Join(" ", Enumerable.Repeat("word", 60));
        var verses = new List<Verse> { VerseWith($"{longText} {ScriptPayload} {longText}") };

        // Act
        var result = service.Create(verses);

        // Assert
        result.Parts.Count.ShouldBeGreaterThan(1);
        foreach (var part in result.Parts)
        {
            part.ShouldStartWith(SlideWrapperStart);
            part.ShouldEndWith(SlideWrapperEnd);
            part.ShouldNotContain("<script");
        }
    }

    [Fact]
    public void Create_WithSwedishTextUnderTheSlideLimit_KeepsItOnOneSlide()
    {
        // Arrange -- 210 characters of Swedish. HTML-encoding turns "ä å ö" into numeric
        // entities, so measuring the encoded string instead of the plain one would split this
        // across several slides.
        var text = string.Join(" ", Enumerable.Repeat("nåden är kärleken själv", 10));
        text.Length.ShouldBeInRange(180, 249);
        var verses = new List<Verse> { VerseWith(text) };

        // Act
        var result = service.Create(verses);

        // Assert
        result.Parts.Count.ShouldBe(1);
    }

    [Fact]
    public void Create_WithSwedishText_RendersTheCharactersUnchangedOnceDecoded()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith("Gud är kärlek") };

        // Act
        var result = service.Create(verses);

        // Assert
        WebUtility.HtmlDecode(Joined(result)).ShouldContain("Gud är kärlek");
    }

    [Fact]
    public void Create_WithMultipleVerses_MarksEachVerseExactlyOnce()
    {
        // Arrange
        var verses = new List<Verse>
        {
            new(BookId, Chapter, 16, PlainVerse),
            new(BookId, Chapter, 17, "that whoever believes in him"),
            new(BookId, Chapter, 18, "should not perish"),
        };

        // Act
        var result = service.Create(verses);

        // Assert
        var html = Joined(result);
        foreach (var verse in verses)
            CountOccurrences(html, $"<sup class=\"opacity-40\">{verse.VerseNumber}</sup>").ShouldBe(1);
    }

    [Fact]
    public void Create_WithMultipleVerses_KeepsEveryWord()
    {
        // Arrange -- long enough to be split, so no word may be lost at a slide boundary
        var verses = Enumerable.Range(1, 12)
            .Select(number => new Verse(BookId, Chapter, number, $"verse{number} {PlainVerse}"))
            .ToList();

        // Act
        var result = service.Create(verses);

        // Assert
        result.Parts.Count.ShouldBeGreaterThan(1);
        var html = Joined(result);
        foreach (var verse in verses)
            html.ShouldContain($"verse{verse.VerseNumber}");
    }

    [Fact]
    public void Create_WithASingleVerse_UsesTheSwedishBookNameInTheTitle()
    {
        // Arrange
        var verses = new List<Verse> { VerseWith(PlainVerse) };

        // Act
        var result = service.Create(verses);

        // Assert
        result.Title.ShouldBe("Johannes 3:16");
    }

    [Fact]
    public void Create_WithNoVerses_ProducesNoSlides()
    {
        // Act
        var result = service.Create([]);

        // Assert
        result.Parts.ShouldBeEmpty();
    }

    private static Verse VerseWith(string text) => new(BookId, Chapter, VerseNumber, text);

    private static string Joined(BibleText text) => string.Join(" ", text.Parts);

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = haystack.IndexOf(needle, StringComparison.Ordinal);
        while (index >= 0)
        {
            count++;
            index = haystack.IndexOf(needle, index + needle.Length, StringComparison.Ordinal);
        }
        return count;
    }
}
