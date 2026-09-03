namespace GospelPresenter.UnitTests.Support;

/// <summary>
/// Finds <c>&lt;input&gt;</c> and <c>&lt;textarea&gt;</c> tags in Razor source that hand their
/// value to the server — the pattern <c>ServerOwnedInputValueTests</c> guards against.
///
/// It lives here, apart from the test that uses it, because it is real logic with its own edge
/// cases and deserves its own tests rather than sitting untested inside an assertion.
/// </summary>
public static class RazorInputScanner
{
    private static readonly string[] TagNames = ["input", "textarea"];

    /// <summary>
    /// The tags in one Razor file whose value the server owns: they render a value and take an
    /// input event, so a re-render can write over what the user is typing.
    /// </summary>
    public static IEnumerable<string> ServerOwnedFields(string razorSource)
    {
        foreach (var (name, start) in TagStarts(razorSource))
        {
            var tag = ReadTag(razorSource, start);
            if (!tag.Contains("@oninput") && !tag.Contains("@bind:event=\"oninput\"")) continue;
            if (IsExempt(tag)) continue;

            yield return $"<{name} …> at offset {start}:\n{tag.Trim()}";
        }
    }

    /// <summary>
    /// The fields the rule does not apply to. A rule rather than a list of files, so it cannot go
    /// stale, and deliberately narrow:
    ///
    /// - Range and colour inputs have no text to lose and no caret to disturb.
    /// - A single-character box is a field whose value the app rewrites on purpose at every
    ///   keystroke — that is how the pairing code auto-advances between boxes. Freezing it would
    ///   remove the feature, and there is at most one character at risk.
    /// </summary>
    public static bool IsExempt(string tag) =>
        tag.Contains("type=\"range\"") ||
        tag.Contains("type=\"color\"") ||
        tag.Contains("maxlength=\"1\"");

    private static IEnumerable<(string Name, int Start)> TagStarts(string text)
    {
        foreach (var name in TagNames)
        {
            var needle = $"<{name}";
            var index = text.IndexOf(needle, StringComparison.Ordinal);
            while (index >= 0)
            {
                // Skip <inputmode…> and anything else that merely starts the same way.
                var after = index + needle.Length;
                if (after >= text.Length || !char.IsLetterOrDigit(text[after]))
                    yield return (name, index);

                index = text.IndexOf(needle, index + needle.Length, StringComparison.Ordinal);
            }
        }
    }

    /// <summary>
    /// Reads one tag, from its <c>&lt;</c> through the <c>&gt;</c> that closes it.
    ///
    /// Naive quote counting is not enough, and neither is stopping at the next <c>&lt;</c>. An
    /// attribute value can contain the closing character — the arrow in
    /// <c>@oninput="e =&gt; …"</c> — and a Razor expression can nest quotes inside an attribute
    /// value, as in <c>@oninput="@(e =&gt; x ?? "#6b7280")"</c>, which breaks parity from there
    /// on. It can also contain a bare <c>&lt;</c>, as in <c>class="@(a &lt; b ? "p" : "q")"</c>,
    /// so a scan that stopped at the first <c>&lt;</c> would truncate the tag and never see an
    /// <c>@oninput</c> written after it — waving a real offender through.
    ///
    /// So quotes are tracked, and quotes appearing inside a parenthesised <c>@(…)</c> expression
    /// are ignored. The one shape this still gets wrong is an unbalanced parenthesis inside a
    /// string nested in a Razor expression, e.g. <c>@(c ? "a(" : "b")</c>; nothing in the
    /// codebase writes that, and the failure would be a false positive, which is the safe
    /// direction.
    /// </summary>
    public static string ReadTag(string text, int start)
    {
        var inAttributeValue = false;
        var parenDepth = 0;

        for (var i = start + 1; i < text.Length; i++)
        {
            var c = text[i];

            if (!inAttributeValue)
            {
                if (c == '"')
                {
                    inAttributeValue = true;
                    parenDepth = 0;
                }
                else if (c == '>')
                {
                    return text[start..(i + 1)];
                }

                continue;
            }

            if (parenDepth == 0 && c == '@' && i + 1 < text.Length && text[i + 1] == '(')
            {
                parenDepth = 1;
                i++;
            }
            else if (parenDepth > 0 && c == '(')
            {
                parenDepth++;
            }
            else if (parenDepth > 0 && c == ')')
            {
                parenDepth--;
            }
            else if (parenDepth == 0 && c == '"')
            {
                inAttributeValue = false;
            }
        }

        return text[start..];
    }
}
