namespace GospelPresenter.Shared.Localization;

/// <summary>The languages the web app is translated into. The first is the default and fallback.</summary>
public static class AppCultures
{
    public static readonly string[] Supported = ["en", "sv"];

    public static string Default => Supported[0];

    /// <summary>
    /// The supported culture name matching <paramref name="culture"/>, ignoring case, or null. /culture
    /// stores what it is given as the user's language, so anything else is refused rather than kept.
    /// </summary>
    public static string? Normalize(string? culture) =>
        Supported.FirstOrDefault(c => string.Equals(c, culture?.Trim(), StringComparison.OrdinalIgnoreCase));
}
