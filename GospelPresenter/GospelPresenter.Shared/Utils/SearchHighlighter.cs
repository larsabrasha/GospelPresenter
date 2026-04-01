using System.Text;

namespace GospelPresenter.Shared.Utils;

public static class SearchHighlighter
{
    public static string Highlight(string text, string[] searchTerms)
    {
        if (searchTerms.Length == 0) return System.Net.WebUtility.HtmlEncode(text);

        text = text.Normalize();
        var textLower = text.ToLowerInvariant();
        var matches = new List<(int Start, int Length)>();

        // Lazy-compute stripped text and position map (only if needed)
        string? textStripped = null;
        int[]? positionMap = null;

        foreach (var term in searchTerms)
        {
            var normalized = term.Normalize().ToLowerInvariant();
            var stripped = TextUtils.RemoveDiacritics(normalized);

            // Exact (accent-preserved) match
            TextUtils.FindWordPrefixMatches(textLower, normalized, matches);

            // Accent-stripped match — map offsets back to original text
            textStripped ??= TextUtils.RemoveDiacritics(textLower);
            positionMap ??= BuildPositionMap(textLower);

            var strippedMatches = new List<(int Start, int Length)>();
            TextUtils.FindWordPrefixMatches(textStripped, stripped, strippedMatches);

            foreach (var (start, _) in strippedMatches)
            {
                if (start < positionMap.Length)
                {
                    var origStart = positionMap[start];
                    var origEnd = start + stripped.Length < positionMap.Length
                        ? positionMap[start + stripped.Length]
                        : textLower.Length;
                    matches.Add((origStart, origEnd - origStart));
                }
            }
        }

        if (matches.Count == 0) return System.Net.WebUtility.HtmlEncode(text);

        matches.Sort((a, b) => a.Start.CompareTo(b.Start));
        var merged = new List<(int Start, int End)> { (matches[0].Start, matches[0].Start + matches[0].Length) };
        for (var i = 1; i < matches.Count; i++)
        {
            var (start, length) = matches[i];
            var last = merged[^1];
            if (start <= last.End)
                merged[^1] = (last.Start, Math.Max(last.End, start + length));
            else
                merged.Add((start, start + length));
        }

        var sb = new StringBuilder();
        var pos = 0;
        foreach (var (start, end) in merged)
        {
            sb.Append(System.Net.WebUtility.HtmlEncode(text[pos..start]));
            sb.Append("<mark class=\"bg-yellow-300/60 dark:bg-yellow-500/40 text-inherit rounded-sm\">");
            sb.Append(System.Net.WebUtility.HtmlEncode(text[start..end]));
            sb.Append("</mark>");
            pos = end;
        }
        sb.Append(System.Net.WebUtility.HtmlEncode(text[pos..]));
        return sb.ToString();
    }

    /// <summary>
    /// Builds a mapping from stripped-text positions to original-text positions.
    /// Handles cases where diacritics removal changes string length.
    /// </summary>
    private static int[] BuildPositionMap(string original)
    {
        var formD = original.Normalize(System.Text.NormalizationForm.FormD);

        // Map FormD positions to original positions
        var formDToOrig = new int[formD.Length + 1];
        var origIdx = 0;
        var formDIdx = 0;
        while (origIdx < original.Length && formDIdx < formD.Length)
        {
            var origChar = original[origIdx];
            var origFormD = origChar.ToString().Normalize(System.Text.NormalizationForm.FormD);
            for (var j = 0; j < origFormD.Length && formDIdx < formD.Length; j++)
            {
                formDToOrig[formDIdx] = origIdx;
                formDIdx++;
            }
            origIdx++;
        }
        formDToOrig[formD.Length] = original.Length;

        // Map stripped positions to original positions
        var map = new List<int>(formD.Length + 1);
        for (var i = 0; i < formD.Length; i++)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(formD[i])
                != System.Globalization.UnicodeCategory.NonSpacingMark)
            {
                map.Add(formDToOrig[i]);
            }
        }
        map.Add(original.Length);

        return map.ToArray();
    }
}
