using System.Text;

namespace GospelPresenter.Shared.Utils;

public static class SearchHighlighter
{
    public static string Highlight(string text, string[] searchTerms)
    {
        if (searchTerms.Length == 0) return System.Net.WebUtility.HtmlEncode(text);

        text = text.Normalize();
        var matches = new List<(int Start, int Length)>();
        foreach (var term in searchTerms)
        {
            var normalized = term.Normalize();
            var idx = 0;
            while (idx <= text.Length - normalized.Length)
            {
                var match = text.IndexOf(normalized, idx, StringComparison.OrdinalIgnoreCase);
                if (match < 0) break;
                matches.Add((match, normalized.Length));
                idx = match + normalized.Length;
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
}
