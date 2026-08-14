using System.Globalization;

namespace GospelPresenter.Shared.State;

/// <summary>
/// How one piece of text on a slide is rendered — the main text or the credits of a slide type.
/// Part of a <see cref="SlideTheme"/>; never configured on its own.
///
/// Sizes are expressed against the fixed 1920x1080 slide canvas. The defaults here are the product's
/// main-text baseline, which every built-in theme inherits: size is one number in one place rather than
/// four numbers that drifted apart. See adr/0001-slide-themes.md.
/// </summary>
public record SlideTextStyle
{
    public int FontSize { get; init; } = 75;
    public string FontFamily { get; init; } = SlideFontFamilies.Tahoma;
    public int FontWeight { get; init; } = 400;
    public double LineHeight { get; init; } = 1.4;

    /// <summary>Any CSS colour, so credits can carry their transparency here rather than as a class.</summary>
    public string Color { get; init; } = "#ffffff";

    public SlideTextAlign Align { get; init; } = SlideTextAlign.Center;

    /// <summary>Keeps text legible on top of a background image. Offsets are in em, so the shadow scales with the text.</summary>
    public bool Shadow { get; init; }

    public string ToCss() =>
        string.Create(CultureInfo.InvariantCulture,
            $"font-family: {FontFamily}; font-size: {FontSize}px; font-weight: {FontWeight}; line-height: {LineHeight}; color: {Color}; text-align: {Align.ToCss()};{(Shadow ? ShadowCss : "")}");

    private const string ShadowCss = " text-shadow: 0 0.06em 0.18em rgba(0, 0, 0, 0.65);";
}

public enum SlideTextAlign
{
    Left,
    Center,
    Right
}

public static class SlideTextAlignExtensions
{
    public static string ToCss(this SlideTextAlign align) => align switch
    {
        SlideTextAlign.Left => "left",
        SlideTextAlign.Right => "right",
        _ => "center"
    };
}

public static class SlideFontFamilies
{
    public const string Tahoma = "'Tahoma', 'Geneva', Verdana, sans-serif";
    public const string Inter = "'Inter', sans-serif";
    public const string Lato = "'Lato', sans-serif";
    public const string Montserrat = "'Montserrat', sans-serif";
    public const string Oswald = "'Oswald', sans-serif";
    public const string PlayfairDisplay = "'Playfair Display', serif";
    public const string Merriweather = "'Merriweather', serif";
}
