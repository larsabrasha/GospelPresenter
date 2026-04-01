using System.Globalization;
using System.Text;

namespace GospelPresenter.Shared.Utils;

public static class TextUtils
{
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
