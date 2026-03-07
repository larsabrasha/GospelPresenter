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
    [GeneratedRegex(@"^(.+)\s+(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$")]
    private static partial Regex ReferencePattern();

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
            return false;

        bookPrefix = match.Groups[1].Value.Trim();
        var fromChapter = int.Parse(match.Groups[2].Value);
        int? fromVerse = match.Groups[3].Success ? int.Parse(match.Groups[3].Value) : null;
        int? toNum = match.Groups[4].Success ? int.Parse(match.Groups[4].Value) : null;
        int? toVerse = match.Groups[5].Success ? int.Parse(match.Groups[5].Value) : null;

        // No range — single chapter or single verse
        if (toNum is null)
        {
            from = (fromChapter, fromVerse ?? 0);
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
