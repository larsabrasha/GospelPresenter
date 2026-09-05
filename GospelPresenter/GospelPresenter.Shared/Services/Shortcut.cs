namespace GospelPresenter.Shared.Services;

/// <summary>
/// One keystroke a component wants to hear about.
/// </summary>
/// <param name="Key">
/// The browser's <c>KeyboardEvent.key</c> value, compared case-insensitively so that a shortcut
/// declared as "n" still fires when caps lock is on. Named keys keep their browser spelling:
/// "ArrowDown", "Escape", "Enter", "Delete", "F2".
/// </param>
/// <param name="Ctrl">
/// True for Ctrl on Windows and Linux and for Cmd on a Mac. The JS layer folds metaKey into this
/// one flag, so a shortcut is declared once and works on every platform. There is deliberately no
/// way to ask for Ctrl on a Mac specifically: the app has no shortcut that needs to tell them apart,
/// and offering the distinction would invite one that behaves differently per platform by accident.
/// </param>
public readonly record struct Shortcut(string Key, bool Ctrl = false, bool Shift = false, bool Alt = false)
{
    /// <summary>
    /// The form the JS layer compares against, so both sides agree on what "the same keystroke"
    /// means without duplicating the rules.
    /// </summary>
    public string ToToken()
    {
        // Shift is dropped for a single printable character, because for those the key value has
        // already accounted for it: "?" is Shift+/ on a US keyboard and Shift+' on a Swedish one,
        // and the browser reports "?" either way. Keeping the flag would make one shortcut match on
        // one layout and not the other. Named keys keep it — Shift+Enter is a real distinction.
        var shift = Shift && Key.Length > 1;
        return $"{(Ctrl ? "c" : "")}{(shift ? "s" : "")}{(Alt ? "a" : "")}:{Key.ToLowerInvariant()}";
    }

    /// <summary>
    /// How the shortcut is written for a human, in the platform's own notation. Used for tooltips
    /// and the help dialog, never for matching.
    /// </summary>
    public string ToDisplay(bool isMac)
    {
        var parts = new List<string>(4);
        if (Ctrl) parts.Add(isMac ? "⌘" : "Ctrl");
        if (Alt) parts.Add(isMac ? "⌥" : "Alt");
        if (Shift) parts.Add(isMac ? "⇧" : "Shift");
        parts.Add(DisplayKey(Key));
        return string.Join(isMac ? "" : "+", parts);
    }

    private static string DisplayKey(string key) => key switch
    {
        "ArrowUp" => "↑",
        "ArrowDown" => "↓",
        "ArrowLeft" => "←",
        "ArrowRight" => "→",
        "Enter" => "↵",
        "Escape" => "Esc",
        "Delete" => "Del",
        " " => "Space",
        // Verbatim, deliberately: "N" would read as Shift+N, which is a different keystroke and one
        // the user would press in vain. A shortcut that really wanted the shifted letter would be
        // declared with the capital in the first place, and this prints that just as faithfully.
        _ => key
    };
}
