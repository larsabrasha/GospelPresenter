using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace GospelPresenter.Shared.Utils;

/// <summary>
/// Makes a stored Bible slide safe to render as markup.
///
/// Bible parts are stored as HTML, built by <c>BibleTextService</c>, and rendered as a MarkupString —
/// including on the anonymous public /watch page. The stored value is not trustworthy, though: a device
/// pushes part content through sync verbatim, and anything that can write a presentation part can
/// write any string. So the HTML is re-emitted through a strict allow-list of exactly what the formatter
/// produces, today and before themes: <c>&lt;div class="text-left"&gt;</c>, <c>&lt;sup class="opacity-40"&gt;</c>,
/// their class-less forms, and <c>&lt;br&gt;</c>. Any other tag, or an allowed tag with any other
/// attribute, is encoded and shows up as text; text is passed through with stray angle brackets encoded.
/// Entities are left alone, since they only ever decode to text.
/// </summary>
public static partial class BibleSlideHtml
{
    private static readonly Dictionary<string, string[]> AllowedClasses = new(StringComparer.Ordinal)
    {
        ["div"] = ["text-left"],
        ["sup"] = ["opacity-40"],
    };

    [GeneratedRegex(@"^<\s*(?<close>/)?\s*(?<name>[a-zA-Z][a-zA-Z0-9]*)(?:\s+class\s*=\s*""(?<class>[a-z0-9-]*)"")?\s*(?<self>/)?\s*>$")]
    private static partial Regex TagPattern();

    public static string Sanitize(string? html)
    {
        if (string.IsNullOrEmpty(html)) return "";

        var output = new StringBuilder(html.Length);
        var open = new Stack<string>();
        var position = 0;

        while (position < html.Length)
        {
            var tagStart = html.IndexOf('<', position);
            if (tagStart < 0)
            {
                AppendText(output, html.AsSpan(position));
                break;
            }

            AppendText(output, html.AsSpan(position, tagStart - position));

            var tagEnd = html.IndexOf('>', tagStart + 1);
            // A '<' that starts another '<' before closing is not a tag; neither is one never closed.
            var nextStart = html.IndexOf('<', tagStart + 1);
            if (tagEnd < 0 || (nextStart >= 0 && nextStart < tagEnd))
            {
                output.Append("&lt;");
                position = tagStart + 1;
                continue;
            }

            var tag = html.Substring(tagStart, tagEnd - tagStart + 1);
            if (!TryAppendTag(output, tag, open))
                output.Append(WebUtility.HtmlEncode(tag));
            position = tagEnd + 1;
        }

        while (open.Count > 0)
            output.Append("</").Append(open.Pop()).Append('>');

        return output.ToString();
    }

    private static bool TryAppendTag(StringBuilder output, string tag, Stack<string> open)
    {
        var match = TagPattern().Match(tag);
        if (!match.Success) return false;

        var name = match.Groups["name"].Value.ToLowerInvariant();
        var isClose = match.Groups["close"].Success;
        var cssClass = match.Groups["class"].Success ? match.Groups["class"].Value : null;

        if (name == "br")
        {
            if (isClose || cssClass is not null) return false;
            output.Append("<br>");
            return true;
        }

        if (!AllowedClasses.TryGetValue(name, out var classes) || match.Groups["self"].Success)
            return false;

        if (isClose)
        {
            if (cssClass is not null) return false;
            // A close that matches nothing open is dropped, so it cannot close the slide's own wrapper.
            if (open.Count > 0 && open.Peek() == name)
                output.Append("</").Append(open.Pop()).Append('>');
            return true;
        }

        if (cssClass is not null && !classes.Contains(cssClass)) return false;

        output.Append('<').Append(name);
        if (cssClass is not null)
            output.Append(" class=\"").Append(cssClass).Append('"');
        output.Append('>');
        open.Push(name);
        return true;
    }

    private static void AppendText(StringBuilder output, ReadOnlySpan<char> text)
    {
        foreach (var c in text)
        {
            switch (c)
            {
                case '<': output.Append("&lt;"); break;
                case '>': output.Append("&gt;"); break;
                default: output.Append(c); break;
            }
        }
    }
}
