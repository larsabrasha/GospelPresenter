using System.Globalization;

namespace GospelPresenter.Shared.State;

public record SlideTextStyle(int FontSize, string FontFamily, int FontWeight, double LineHeight)
{
    public static readonly SlideTextStyle SongDefault = new(85, SlideFontFamilies.Tahoma, 400, 1.2);
    public static readonly SlideTextStyle BibleDefault = new(85, SlideFontFamilies.Tahoma, 400, 1.2);
    public static readonly SlideTextStyle CreditsDefault = new(40, SlideFontFamilies.Tahoma, 400, 1.2);

    public string ToCss() =>
        string.Create(CultureInfo.InvariantCulture,
            $"font-family: {FontFamily}; font-size: {FontSize}px; font-weight: {FontWeight}; line-height: {LineHeight};");
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

    public static readonly IReadOnlyList<(string Value, string LocalizationKey)> Options =
    [
        (Tahoma, "SlideSettings.FontFamily.Tahoma"),
        (Inter, "SlideSettings.FontFamily.Inter"),
        (Lato, "SlideSettings.FontFamily.Lato"),
        (Montserrat, "SlideSettings.FontFamily.Montserrat"),
        (Oswald, "SlideSettings.FontFamily.Oswald"),
        (PlayfairDisplay, "SlideSettings.FontFamily.PlayfairDisplay"),
        (Merriweather, "SlideSettings.FontFamily.Merriweather"),
    ];
}

public static class SlideFontWeights
{
    public static readonly IReadOnlyList<(int Value, string LocalizationKey)> Options =
    [
        (300, "SlideSettings.FontWeight.Light"),
        (400, "SlideSettings.FontWeight.Regular"),
        (500, "SlideSettings.FontWeight.Medium"),
        (600, "SlideSettings.FontWeight.SemiBold"),
        (700, "SlideSettings.FontWeight.Bold"),
        (800, "SlideSettings.FontWeight.ExtraBold"),
    ];
}
