using System.Globalization;
using System.Text;

namespace GospelPresenter.Shared.Utils;

public static class TextUtils
{
    /// <summary>
    /// Puts text in Unicode NFC (composed) form. macOS file names and some ProPresenter
    /// fields arrive decomposed, where "ä" is "a" plus a combining diaeresis; that reads the same
    /// on screen but compares unequal to the composed form the rest of the app uses, which
    /// silently breaks duplicate detection, sorting and ordinal search.
    /// </summary>
    public static string NormalizeUnicode(string text)
    {
        if (text.Length == 0) return text;
        try
        {
            return text.IsNormalized(NormalizationForm.FormC) ? text : text.Normalize(NormalizationForm.FormC);
        }
        catch (ArgumentException)
        {
            // Invalid surrogate pairs cannot be normalized; keep the text as it came in.
            return text;
        }
    }

    /// <summary>
    /// Compares text ignoring case and Unicode composition form. Song names and part labels
    /// imported before the parser started composing are stored decomposed, so a plain ordinal
    /// comparer reads the same title written two ways as two different titles.
    /// </summary>
    public static IEqualityComparer<string> NormalizedIgnoreCase { get; } = new NormalizedIgnoreCaseComparer();

    private sealed class NormalizedIgnoreCaseComparer : IEqualityComparer<string>
    {
        public bool Equals(string? x, string? y)
        {
            if (x is null || y is null) return ReferenceEquals(x, y);
            return string.Equals(NormalizeUnicode(x), NormalizeUnicode(y), StringComparison.OrdinalIgnoreCase);
        }

        public int GetHashCode(string obj) =>
            StringComparer.OrdinalIgnoreCase.GetHashCode(NormalizeUnicode(obj));
    }

    public static string RemoveDiacritics(string text)
    {
        var normalized = text.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                sb.Append(c);
        }
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    public static bool ContainsWordPrefix(string text, string prefix)
    {
        var index = 0;
        while (true)
        {
            index = text.IndexOf(prefix, index, StringComparison.Ordinal);
            if (index < 0)
                return false;

            if (index == 0 || !char.IsLetterOrDigit(text[index - 1]))
                return true;

            index += prefix.Length;
        }
    }

    public static void FindWordPrefixMatches(string text, string term, List<(int Start, int Length)> matches)
    {
        var idx = 0;
        while (idx <= text.Length - term.Length)
        {
            var match = text.IndexOf(term, idx, StringComparison.Ordinal);
            if (match < 0) break;

            if (match == 0 || !char.IsLetterOrDigit(text[match - 1]))
                matches.Add((match, term.Length));

            idx = match + term.Length;
        }
    }
}
