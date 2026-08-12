namespace GospelPresenter.Shared.Utils;

/// <summary>
/// Converts plain-text slide content (e.g. song lyrics) into the HTML fragment rendered on a
/// slide. The text is HTML-encoded first so user-authored content cannot inject markup or
/// script, then newlines are turned into &lt;br&gt;. Use this everywhere raw slide text would
/// otherwise be passed to a <c>MarkupString</c>.
/// </summary>
public static class SlideText
{
    public static string PlainToHtml(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        return System.Net.WebUtility.HtmlEncode(text).Replace("\n", "<br>");
    }
}
