using GospelPresenter.Shared.State;

namespace GospelPresenter.UnitTests.Support;

/// <summary>
/// Estimates how much room a piece of slide text needs, so a test can assert that no built-in theme
/// renders text that overflows the canvas. Slides clip silently, so without this the only thing
/// guarding the invariant would be someone eyeballing a preview.
///
/// This is deliberately an approximation: average glyph advance per font rather than real font
/// metrics. It is used to compare themes against Classic and against the canvas with a margin, not
/// to lay out text — that is what shrink-to-fit will need if it is ever built.
/// </summary>
public static class SlideTextFitEstimator
{
    // The canvas and its padding, from Slide.razor: px-20 (80px each side), pt-20 (80px), pb-36 (144px).
    public const double CanvasWidth = 1920;
    public const double CanvasHeight = 1080;
    public const double ContentWidth = CanvasWidth - 80 - 80;
    public const double ContentHeight = CanvasHeight - 80 - 144;

    /// <summary>Average glyph advance as a fraction of the font size, measured at weight 400.</summary>
    private static readonly Dictionary<string, double> AdvancePerEm = new()
    {
        [SlideFontFamilies.Tahoma] = 0.55,
        [SlideFontFamilies.Inter] = 0.52,
        [SlideFontFamilies.Lato] = 0.50,
        [SlideFontFamilies.Montserrat] = 0.60,
        [SlideFontFamilies.Oswald] = 0.44,
        [SlideFontFamilies.PlayfairDisplay] = 0.50,
        [SlideFontFamilies.Merriweather] = 0.56
    };

    public record Block(double Width, double Height)
    {
        public bool FitsCanvas => Width <= ContentWidth && Height <= ContentHeight;
    }

    public static Block Estimate(string text, SlideTextStyle style)
    {
        var charWidth = CharacterWidth(style);
        var maxCharsPerLine = Math.Max(1, (int)(ContentWidth / charWidth));

        var lineCount = 0;
        var longestLine = 0;

        foreach (var paragraph in text.Split('\n'))
        {
            var wrapped = WrapLengths(paragraph, maxCharsPerLine);
            lineCount += wrapped.Count;
            longestLine = Math.Max(longestLine, wrapped.Count == 0 ? 0 : wrapped.Max());
        }

        return new Block(longestLine * charWidth, lineCount * style.FontSize * style.LineHeight);
    }

    private static double CharacterWidth(SlideTextStyle style)
    {
        if (!AdvancePerEm.TryGetValue(style.FontFamily, out var advance))
            throw new ArgumentException(
                $"No glyph metrics for '{style.FontFamily}'. Add it here when a theme starts using a new font, "
                + "otherwise the overflow invariant silently stops covering that theme.");

        // Heavier weights are slightly wider.
        var weightFactor = 1 + Math.Max(0, style.FontWeight - 400) / 100 * 0.015;
        return style.FontSize * advance * weightFactor;
    }

    private static List<int> WrapLengths(string paragraph, int maxCharsPerLine)
    {
        var lengths = new List<int>();
        var current = 0;

        foreach (var word in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = current == 0 ? word.Length : current + 1 + word.Length;
            if (candidate > maxCharsPerLine && current > 0)
            {
                lengths.Add(current);
                current = word.Length;
            }
            else
            {
                current = candidate;
            }
        }

        if (current > 0 || lengths.Count == 0) lengths.Add(current);
        return lengths;
    }
}
