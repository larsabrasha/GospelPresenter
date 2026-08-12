using System.Net;
using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public interface IBibleTextService
{
    BibleText? GetById(string id);
    BibleText Create(List<Verse> verses);
}

public class BibleTextService : IBibleTextService
{
    private const int MaxCharsPerSlide = 250;

    private readonly Dictionary<string, BibleText> store = new();

    public BibleText? GetById(string id)
    {
        return store.GetValueOrDefault(id);
    }

    public BibleText Create(List<Verse> verses)
    {
        var id = Guid.NewGuid().ToString();
        var title = FormatTitle(verses);
        var parts = BuildSlides(verses);

        var bibleText = new BibleText(id, title, parts);
        store[id] = bibleText;
        return bibleText;
    }

    private static string FormatTitle(List<Verse> verses)
    {
        if (verses.Count == 0) return "";
        var first = verses[0];
        var last = verses[^1];
        var bookName = BibleBookNames.GetSwedishName(first.BookId);
        if (first.BookId == last.BookId && first.Chapter == last.Chapter && first.VerseNumber == last.VerseNumber)
            return $"{bookName} {first.Chapter}:{first.VerseNumber}";
        if (first.BookId == last.BookId && first.Chapter == last.Chapter)
            return $"{bookName} {first.Chapter}:{first.VerseNumber}-{last.VerseNumber}";
        if (first.BookId == last.BookId)
            return $"{bookName} {first.Chapter}:{first.VerseNumber}-{last.Chapter}:{last.VerseNumber}";
        return $"{bookName} {first.Chapter}:{first.VerseNumber} - {BibleBookNames.GetSwedishName(last.BookId)} {last.Chapter}:{last.VerseNumber}";
    }

    /// <summary>
    /// A single word of verse text, preceded by a verse marker when it is the first word of a
    /// verse. Slides are split on these, measuring plain text, and the HTML is generated once at
    /// the end. That way verse text is encoded exactly once and no markup-aware code ever sees
    /// user-authored content.
    /// </summary>
    private readonly record struct SlideWord(int? VerseNumber, string Text)
    {
        /// Characters this word contributes on screen: the text itself plus, for the first word
        /// of a verse, the verse digits and the non-breaking space that follows them.
        public int PlainLength =>
            Text.Length + (VerseNumber is { } number ? number.ToString().Length + 1 : 0);

        public string ToHtml() =>
            VerseNumber is { } number
                ? $"<sup class=\"opacity-40\">{number}</sup>\u00a0{WebUtility.HtmlEncode(Text)}"
                : WebUtility.HtmlEncode(Text);
    }

    private static List<string> BuildSlides(List<Verse> verses)
    {
        var words = ToWords(verses);
        if (words.Count == 0) return [];

        // The space between two words counts as one character, as it did when a slide was
        // measured as one joined string.
        var totalPlainLength = words.Sum(word => word.PlainLength) + words.Count - 1;
        var slideCount = Math.Max(1, (int)Math.Ceiling((double)totalPlainLength / MaxCharsPerSlide));
        var targetPerSlide = (int)Math.Ceiling((double)totalPlainLength / slideCount);

        var slides = new List<string>();
        var current = new List<SlideWord>();
        var currentLength = 0;

        foreach (var word in words)
        {
            var candidateLength = current.Count == 0
                ? word.PlainLength
                : currentLength + 1 + word.PlainLength;

            if (candidateLength > targetPerSlide && current.Count > 0 && slides.Count < slideCount - 1)
            {
                slides.Add(RenderSlide(current));
                current.Clear();
                current.Add(word);
                currentLength = word.PlainLength;
            }
            else
            {
                current.Add(word);
                currentLength = candidateLength;
            }
        }

        if (current.Count > 0)
            slides.Add(RenderSlide(current));

        return slides;
    }

    private static List<SlideWord> ToWords(List<Verse> verses)
    {
        var words = new List<SlideWord>();

        foreach (var verse in verses)
        {
            var parts = verse.Text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                words.Add(new SlideWord(verse.VerseNumber, ""));
                continue;
            }

            words.Add(new SlideWord(verse.VerseNumber, parts[0]));
            for (var i = 1; i < parts.Length; i++)
                words.Add(new SlideWord(null, parts[i]));
        }

        return words;
    }

    private static string RenderSlide(List<SlideWord> words) =>
        $"<div class=\"text-left\">{string.Join(" ", words.Select(word => word.ToHtml()))}</div>";
}
