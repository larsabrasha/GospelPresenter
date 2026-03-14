using System.Text.RegularExpressions;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Parses Bible reference queries and filters verses accordingly.
///
/// Supported formats:
///   "Matt 3"          → all verses in chapter 3
///   "Matt 3:15"       → single verse
///   "Matt 3:15-17"    → verse range within a chapter
///   "Matt 3:15-4"     → chapter 3 verse 15 through all of chapter 4
///   "Matt 3-4"        → all of chapters 3-4
///   "Matt 3:15-4:6"   → chapter 3 verse 15 through chapter 4 verse 6
/// </summary>
public static partial class VerseSearch
{
    // Captures: (book) (fromChapter) (fromVerse)? (toChapterOrVerse)? (toVerse)?
    // Trailing colon or dash is allowed (e.g. "matt 1:" or "matt 1:2-")
    [GeneratedRegex(@"^(.+)\s+(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?[-:]?$")]
    private static partial Regex ReferencePattern();

    // Book-only query (e.g. "ma", "matt")
    [GeneratedRegex(@"^([a-zA-ZåäöÅÄÖ0-9: ]+?)$")]
    private static partial Regex BookOnlyPattern();

    // Normalizes spaces around ":" and "-" so the main regex doesn't need to handle them
    [GeneratedRegex(@"\s*([:\-])\s*")]
    private static partial Regex PunctuationSpaces();

    [GeneratedRegex(@"\s+")]
    private static partial Regex MultipleSpaces();

    public static IEnumerable<Verse> Search(IEnumerable<Verse> verses, string query)
    {
        if (!TryParseQuery(query, out var bookPrefix, out var from, out var to))
            return [];

        // Resolve Swedish name/abbreviation to book code, fall back to prefix match
        var bookCode = BibleBookNames.Resolve(bookPrefix);

        return verses.Where(v =>
            (bookCode is not null
                ? v.BookId.Equals(bookCode, StringComparison.OrdinalIgnoreCase)
                : v.BookId.StartsWith(bookPrefix, StringComparison.OrdinalIgnoreCase))
            && IsInRange((v.Chapter, v.VerseNumber), from, to));
    }

    internal static bool TryParseQuery(
        string query,
        out string bookPrefix,
        out (int Chapter, int Verse) from,
        out (int Chapter, int Verse) to)
    {
        bookPrefix = "";
        from = (0, 0);
        to = (0, 0);

        // Normalize: "Matt  3 : 15 - 4" → "Matt 3:15-4"
        query = MultipleSpaces().Replace(query.Trim(), " ");
        query = PunctuationSpaces().Replace(query, "$1");

        var match = ReferencePattern().Match(query);
        if (!match.Success)
        {
            // Book-only query: return all verses for the matched book
            var bookOnly = BookOnlyPattern().Match(query);
            if (!bookOnly.Success)
                return false;

            bookPrefix = bookOnly.Groups[1].Value.Trim();
            if (BibleBookNames.Resolve(bookPrefix) is null)
                return false;

            from = (0, 0);
            to = (int.MaxValue, int.MaxValue);
            return true;
        }

        bookPrefix = match.Groups[1].Value.Trim();
        var fromChapter = int.Parse(match.Groups[2].Value);
        int? fromVerse = match.Groups[3].Success ? int.Parse(match.Groups[3].Value) : null;
        int? toNum = match.Groups[4].Success ? int.Parse(match.Groups[4].Value) : null;
        int? toVerse = match.Groups[5].Success ? int.Parse(match.Groups[5].Value) : null;

        // No range — single chapter or single verse
        if (toNum is null)
        {
            from = (fromChapter, fromVerse ?? 0);
            // Trailing dash (e.g. "Matt 3:1-") means from verse to end of chapter
            if (fromVerse.HasValue && query.EndsWith('-'))
                to = (fromChapter, int.MaxValue);
            else
                to = (fromChapter, fromVerse ?? int.MaxValue);
            return true;
        }

        from = (fromChapter, fromVerse ?? 0);

        // "to" interpretation when it's a bare number (no colon) depends on context:
        //   "3:15-17"  → 17 >= 15 (fromVerse), so it's a verse in the same chapter
        //   "3:15-4"   → 4 < 15 (fromVerse), so it's a chapter
        //   "3:15-4:6" → explicit chapter:verse
        //   "3-4"      → chapter range (no fromVerse)
        if (fromVerse.HasValue && toVerse is null && toNum >= fromVerse)
        {
            to = (fromChapter, toNum.Value);
        }
        else if (toVerse.HasValue)
        {
            to = (toNum.Value, toVerse.Value);
        }
        else
        {
            to = (toNum.Value, int.MaxValue);
        }

        return true;
    }

    private static bool IsInRange(
        (int Chapter, int Verse) value,
        (int Chapter, int Verse) from,
        (int Chapter, int Verse) to)
    {
        return value.CompareTo(from) >= 0 && value.CompareTo(to) <= 0;
    }
}
