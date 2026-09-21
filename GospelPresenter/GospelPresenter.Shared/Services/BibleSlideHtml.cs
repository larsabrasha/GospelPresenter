using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// The one place Bible-slide markup is allowed to come from.
///
/// <see cref="BibleTextService"/> builds a slide as HTML and that HTML is stored in
/// <c>PresentationItemPart.Content</c> and rendered back as a <c>MarkupString</c> — on the
/// operator's screen, on the projector and, through the public output, in anonymous visitors'
/// browsers. Anything that can write a part can therefore write markup, and the offline sync push
/// takes parts straight from a device. So the grammar the service emits is pinned here, and every
/// render goes through <see cref="Sanitize"/>: what conforms is re-encoded exactly once, what does
/// not is shown as text. Nothing else ever reaches a MarkupString.
///
/// The grammar, exactly as every version of the service has produced it (checked against the
/// history of BibleTextService): an optional wrapper <c>&lt;div&gt;</c> or
/// <c>&lt;div class="text-left"&gt;</c> closed by <c>&lt;/div&gt;</c>; inside it, verse markers
/// <c>&lt;sup&gt;N&lt;/sup&gt;</c> or <c>&lt;sup class="opacity-40"&gt;N&lt;/sup&gt;</c> with one to
/// four digits; and text, which older rows carry raw and newer rows carry HTML-encoded. Seeded
/// mock data is plain text with no wrapper at all. No other tag, attribute or nesting is legitimate.
/// </summary>
public static partial class BibleSlideHtml
{
    private static readonly string[] WrapperStarts = ["<div class=\"text-left\">", "<div>"];
    private const string WrapperEnd = "</div>";
    private static readonly string[] MarkerStarts = ["<sup class=\"opacity-40\">", "<sup>"];
    private const string MarkerEnd = "</sup>";
    private const int MaxVerseDigits = 4;

    /// <summary>True when the content is exactly what the emitter could have produced.</summary>
    public static bool IsWellFormed(string? content) => TryParse(content ?? "", out _);

    /// <summary>
    /// The markup to render. Conforming content comes back with the same wrapper and markers and
    /// with every text run encoded once, whether it was stored raw or already encoded. Anything
    /// else degrades to visible text: tags stripped, the rest encoded — never markup, and never a
    /// blank slide in front of a congregation.
    /// </summary>
    public static string Sanitize(string? content)
    {
        content ??= "";
        if (TryParse(content, out var slide))
            return slide.Render();

        return EncodeText(WebUtility.HtmlDecode(TagPattern().Replace(content, "")));
    }

    private static bool TryParse(string content, out ParsedSlide slide)
    {
        slide = default;
        var body = content.AsSpan();
        string? wrapper = null;

        foreach (var start in WrapperStarts)
        {
            if (!body.StartsWith(start, StringComparison.Ordinal)) continue;
            if (!body.EndsWith(WrapperEnd, StringComparison.Ordinal)) return false;
            wrapper = start;
            body = body[start.Length..^WrapperEnd.Length];
            break;
        }

        var tokens = new List<Token>();
        var i = 0;
        while (i < body.Length)
        {
            if (body[i] != '<')
            {
                var next = body[i..].IndexOf('<');
                var run = next < 0 ? body[i..] : body.Slice(i, next);
                tokens.Add(new Token(null, run.ToString()));
                i += run.Length;
                continue;
            }

            if (!TryReadMarker(body[i..], out var marker, out var consumed))
                return false;
            tokens.Add(marker);
            i += consumed;
        }

        slide = new ParsedSlide(wrapper, tokens);
        return true;
    }

    private static bool TryReadMarker(ReadOnlySpan<char> at, out Token marker, out int consumed)
    {
        marker = default;
        consumed = 0;

        foreach (var start in MarkerStarts)
        {
            if (!at.StartsWith(start, StringComparison.Ordinal)) continue;

            var digits = 0;
            while (start.Length + digits < at.Length && char.IsAsciiDigit(at[start.Length + digits]))
                digits++;
            if (digits is 0 or > MaxVerseDigits) return false;

            var end = start.Length + digits;
            if (!at[end..].StartsWith(MarkerEnd, StringComparison.Ordinal)) return false;

            marker = new Token(start, at.Slice(start.Length, digits).ToString());
            consumed = end + MarkerEnd.Length;
            return true;
        }

        return false;
    }

    /// <summary>
    /// Encodes the five characters that can change how a browser reads text — and only those.
    /// <see cref="WebUtility.HtmlEncode"/> also turns Latin-1 letters and the non-breaking space
    /// after a verse marker into numeric entities, which is harmless but would make the output
    /// differ from what the service wrote for no reason.
    /// </summary>
    private static string EncodeText(string text)
    {
        var sb = new StringBuilder(text.Length + 16);
        foreach (var c in text)
        {
            sb.Append(c switch
            {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '"' => "&quot;",
                '\'' => "&#39;",
                _ => c.ToString(),
            });
        }
        return sb.ToString();
    }

    /// <summary>A verse marker (Start is the literal tag it opened with) or, with a null Start, a text run.</summary>
    private readonly record struct Token(string? Start, string Value);

    private readonly record struct ParsedSlide(string? Wrapper, List<Token> Tokens)
    {
        public string Render()
        {
            var sb = new StringBuilder();
            if (Wrapper is not null) sb.Append(Wrapper);
            foreach (var token in Tokens ?? [])
            {
                if (token.Start is null)
                    sb.Append(EncodeText(WebUtility.HtmlDecode(token.Value)));
                else
                    sb.Append(token.Start).Append(token.Value).Append(MarkerEnd);
            }
            if (Wrapper is not null) sb.Append(WrapperEnd);
            return sb.ToString();
        }
    }

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex TagPattern();
}
