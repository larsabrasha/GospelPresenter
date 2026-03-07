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

    private static List<string> BuildSlides(List<Verse> verses)
    {
        var fullText = string.Join(" ", verses.Select(v =>
            $"<sup class=\"opacity-40\">{v.VerseNumber}</sup>\u00a0{v.Text}"));

        var totalPlainLength = PlainTextLength(fullText);
        var slideCount = Math.Max(1, (int)Math.Ceiling((double)totalPlainLength / MaxCharsPerSlide));
        var targetPerSlide = (int)Math.Ceiling((double)totalPlainLength / slideCount);

        var slides = new List<string>();
        var words = fullText.Split(' ');
        var current = "";

        foreach (var word in words)
        {
            var candidate = current.Length == 0 ? word : $"{current} {word}";
            var plainLength = PlainTextLength(candidate);

            if (plainLength > targetPerSlide && current.Length > 0 && slides.Count < slideCount - 1)
            {
                slides.Add($"<div class=\"text-left\">{current}</div>");
                current = word;
            }
            else
            {
                current = candidate;
            }
        }

        if (current.Length > 0)
            slides.Add($"<div class=\"text-left\">{current}</div>");

        return slides;
    }

    private static int PlainTextLength(string html)
    {
        var inTag = false;
        var count = 0;
        foreach (var c in html)
        {
            if (c == '<') inTag = true;
            else if (c == '>') inTag = false;
            else if (!inTag) count++;
        }
        return count;
    }
}
