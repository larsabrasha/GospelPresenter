using System.Globalization;

namespace GospelPresenter.Shared.State;

/// <summary>
/// How the slides of a presentation are displayed: one block per slide type, each with a background
/// and — for the types that carry text — a style for the main text and one for the credits.
///
/// A theme is chosen for a whole presentation, never for a single slide. Themes are stored as the
/// JSON definition of a <c>Theme</c> row; see adr/0001-slide-themes.md.
/// </summary>
public record SlideTheme
{
    public SlideStyle Song { get; init; } = new();
    public SlideStyle BibleText { get; init; } = new();

    /// <summary>
    /// Images and imported slide decks fill the canvas themselves, so this type has a background
    /// and no text. It is what shows in the letterbox around an image that is not 16:9.
    /// </summary>
    public SlideBackground Media { get; init; } = new();

    public SlideStyle? TextStyleFor(ProjectItemType? itemType) => itemType switch
    {
        ProjectItemType.Song => Song,
        ProjectItemType.BibleText => BibleText,
        _ => null
    };

    public SlideBackground BackgroundFor(ProjectItemType? itemType) => itemType switch
    {
        ProjectItemType.BibleText => BibleText.Background,
        ProjectItemType.Image or ProjectItemType.Slides => Media,
        _ => Song.Background
    };

    /// <summary>
    /// The look Gospel Presenter recommends: white Tahoma on black, song lyrics in bold and Bible text
    /// in regular weight, both at the 75px baseline with an airy line.
    ///
    /// It is deliberately *not* what the application rendered before themes existed (85px, regular
    /// weight, 1.2). Nobody chose those values — they were a code default — and a presentation that has
    /// not picked a theme lands here, so slides do change appearance the first time this ships.
    ///
    /// Bible text is left-aligned because <c>BibleTextService</c> has always wrapped it in a
    /// left-aligned div, and those divs are frozen in already-stored presentation parts.
    /// </summary>
    public static readonly SlideTheme Classic = new()
    {
        Song = new SlideStyle { MainText = new SlideTextStyle { FontWeight = 700 } },
        BibleText = new SlideStyle { MainText = new SlideTextStyle { Align = SlideTextAlign.Left } }
    };

    /// <summary>
    /// Used only when a theme cannot be resolved — a missing row, or a presentation pointing at a
    /// theme that no longer exists. Never the normal path: a presentation without a theme of its own
    /// follows the organisation's default theme.
    /// </summary>
    public static SlideTheme Fallback => Classic;
}

/// <summary>A slide type that carries text: its background plus the two text roles.</summary>
public record SlideStyle
{
    public SlideBackground Background { get; init; } = new();
    public SlideTextStyle MainText { get; init; } = new();
    public SlideTextStyle Credits { get; init; } = new()
    {
        FontSize = 40,
        LineHeight = 1.2,
        Color = "rgba(255, 255, 255, 0.4)",
        Align = SlideTextAlign.Left
    };
}

public record SlideBackground
{
    public string Color { get; init; } = "#000000";

    public SlideBackgroundImage? Image { get; init; }

    public SlideBackgroundFit Fit { get; init; } = SlideBackgroundFit.Cover;

    /// <summary>
    /// How much black is laid over the background image, 0–100. White text on an undimmed photo is
    /// unreadable, so a theme with an image is expected to set this.
    /// </summary>
    public int ScrimPercent { get; init; }

    /// <summary>
    /// The CSS for the slide canvas. The image URL is resolved by the caller, because it depends on
    /// the context the slide is rendered in (editing, a live session, a public output).
    /// </summary>
    public string ToCss(string? imageUrl)
    {
        var css = $"background-color: {Color};";
        if (imageUrl is null) return css;

        // Escaped even though today's only producer is a code constant: this string lands in a style
        // attribute, so a quote in the URL would end the url() and let the rest of it inject CSS. When
        // user-uploaded backgrounds arrive, the value comes from the database.
        var url = imageUrl.Replace("\\", "\\\\").Replace("'", "\\'");

        var scrim = Math.Clamp(ScrimPercent, 0, 100) / 100.0;
        var layers = scrim > 0
            ? string.Create(CultureInfo.InvariantCulture,
                $"linear-gradient(rgba(0, 0, 0, {scrim:0.##}), rgba(0, 0, 0, {scrim:0.##})), url('{url}')")
            : $"url('{url}')";

        return css
               + $" background-image: {layers};"
               + $" background-size: {(Fit == SlideBackgroundFit.Contain ? "contain" : "cover")};"
               + " background-position: center; background-repeat: no-repeat;";
    }
}

/// <summary>
/// Which image a background uses. Discriminated rather than a plain URL: built-in themes ship their
/// art with the product, while organisation-owned themes will point at an uploaded image that has to
/// be served through the live and public-output proxies. One helper translates both to a URL.
/// </summary>
public record SlideBackgroundImage
{
    public SlideImageSource Source { get; init; } = SlideImageSource.BuiltInAsset;

    /// <summary>An asset path for <see cref="SlideImageSource.BuiltInAsset"/>, an image id otherwise.</summary>
    public string Value { get; init; } = "";

    /// <summary>
    /// The first 16 hex characters of the asset's SHA-256. Built-in themes are updated in place, so the
    /// hash is what makes a changed image reach projectors and phones that cached the old one
    /// indefinitely. Unused for organisation images, which get a fresh id instead.
    /// </summary>
    public string ContentHash { get; init; } = "";
}

public enum SlideImageSource
{
    BuiltInAsset,
    OrganizationImage
}

public enum SlideBackgroundFit
{
    Cover,
    Contain
}
