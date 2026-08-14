using Bunit;
using GospelPresenter.Shared.Components.Presentations;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The public output is the one surface a congregation's visitors see, and the only one that does not use
/// the fixed 1920x1080 canvas: it reflows and sizes text from the viewport. That makes it the easiest place
/// for a theme to be applied inconsistently — a background that never lands, or text that keeps its old
/// hardcoded white on a light theme — so it is asserted here rather than by looking at it once.
/// </summary>
public class PublicSlideViewTests : TestContext
{
    private const string SongContent = "Amazing grace";
    private const string Credits = "John Newton · 1779";

    public PublicSlideViewTests()
    {
        // The component itself has no localized strings, but _Imports.razor injects the localizer into
        // every component, so it has to be resolvable.
        Services.AddLocalization();
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new Microsoft.Extensions.Options.OptionsWrapper<LocalizationOptions>(new LocalizationOptions()),
                    Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance)));
    }

    [Fact]
    public void SongSlide_UsesTheThemesTypographyAndColour()
    {
        var theme = ThemeWith(new SlideTextStyle
        {
            FontSize = 70,
            FontFamily = SlideFontFamilies.Lato,
            FontWeight = 600,
            LineHeight = 1.4,
            Color = "#141210",
            Align = SlideTextAlign.Left
        });

        var style = RenderSongSlide(theme).Find("div[style*='font-family']").GetAttribute("style")!;

        style.ShouldContain("'Lato'");
        style.ShouldContain("font-weight: 600");
        style.ShouldContain("line-height: 1.4");
        style.ShouldContain("color: #141210");
        style.ShouldContain("text-align: left");
    }

    /// <summary>
    /// A phone in portrait would render the configured pixel size at about a fifth of its intended size, so
    /// this view replaces the fixed size with a viewport-relative one — capped at what the theme asked for.
    /// </summary>
    [Fact]
    public void SongSlide_CapsTheResponsiveSizeAtTheThemesSize()
    {
        var theme = ThemeWith(new SlideTextStyle { FontSize = 70 });

        var style = RenderSongSlide(theme).Find("div[style*='font-family']").GetAttribute("style")!;

        style.ShouldContain("clamp(");
        style.ShouldContain("70px)");
        // The theme's own fixed size must come before the responsive override, or the cap wins over it.
        style.IndexOf("font-size: 70px", StringComparison.Ordinal)
            .ShouldBeLessThan(style.IndexOf("clamp(", StringComparison.Ordinal));
    }

    [Fact]
    public void SlideBackground_UsesTheThemesColour()
    {
        var theme = new SlideTheme
        {
            Song = new SlideStyle { Background = new SlideBackground { Color = "#0b1b3a" } }
        };

        var container = RenderSongSlide(theme).Find("div.absolute.inset-0");

        container.GetAttribute("style")!.ShouldContain("background-color: #0b1b3a");
    }

    /// <summary>
    /// The scrim is what keeps white text readable on a photograph. It is a gradient layered over the image
    /// rather than an extra element, so it has to survive into this view's markup too.
    /// </summary>
    [Fact]
    public void SlideBackground_LayersTheScrimOverTheImage()
    {
        var theme = new SlideTheme
        {
            Song = new SlideStyle
            {
                Background = new SlideBackground
                {
                    Color = "#0d1024",
                    Image = new SlideBackgroundImage
                    {
                        Source = SlideImageSource.BuiltInAsset,
                        Value = BuiltInThemes.AuroraBackgroundAsset,
                        ContentHash = BuiltInThemes.AuroraBackgroundHash
                    },
                    ScrimPercent = 45
                }
            }
        };

        var style = RenderSongSlide(theme).Find("div.absolute.inset-0").GetAttribute("style")!;

        style.ShouldContain("linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45))");
        style.ShouldContain($"/api/theme-images/{BuiltInThemes.AuroraBackgroundAsset}-full-{BuiltInThemes.AuroraBackgroundHash}.webp");
        style.ShouldContain("background-size: cover");
    }

    /// <summary>
    /// Credits used to be a hardcoded 40% white, which on a light theme is invisible.
    /// </summary>
    [Fact]
    public void Credits_UseTheThemesCreditsColour()
    {
        var theme = new SlideTheme
        {
            Song = new SlideStyle
            {
                Credits = new SlideTextStyle { FontSize = 40, Color = "rgba(20, 18, 16, 0.55)" }
            }
        };

        var rendered = RenderSongSlide(theme);
        var credits = rendered.FindAll("div[style*='font-family']")
            .Single(e => e.TextContent.Contains("John Newton"));

        credits.GetAttribute("style")!.ShouldContain("rgba(20, 18, 16, 0.55)");
    }

    /// <summary>A Bible slide takes its credits from the Bible block, not the song block.</summary>
    [Fact]
    public void BibleSlide_UsesTheBibleBlock()
    {
        var theme = new SlideTheme
        {
            Song = new SlideStyle { MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Oswald } },
            BibleText = new SlideStyle
            {
                Background = new SlideBackground { Color = "#faf7f2" },
                MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Merriweather },
                Credits = new SlideTextStyle { FontSize = 40, Color = "#111111" }
            }
        };

        var rendered = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.BibleText, "item", 0,
            "<div>For God so loved the world</div>", Credits, null, null, theme));

        rendered.Find("div.absolute.inset-0").GetAttribute("style")!.ShouldContain("#faf7f2");
        rendered.Markup.ShouldContain("'Merriweather'");
        rendered.Markup.ShouldNotContain("'Oswald'");
        rendered.FindAll("div[style*='font-family']")
            .Single(e => e.TextContent.Contains("John Newton"))
            .GetAttribute("style")!.ShouldContain("color: #111111");
    }

    [Fact]
    public void ImageSlide_RendersTheImageAndNoText()
    {
        var rendered = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Image, "item", 0,
            null, null, "/api/watch/abc/image/org-image/1/full", null, SlideTheme.Classic));

        rendered.Find("img").GetAttribute("src").ShouldBe("/api/watch/abc/image/org-image/1/full");
        rendered.FindAll("div[style*='font-family']").ShouldBeEmpty();
    }

    /// <summary>
    /// Overlays sit on top of unknown content and are deliberately outside the theme: a theme that made
    /// them dark would render them invisible over a dark slide.
    /// </summary>
    [Fact]
    public void Overlay_KeepsItsOwnLegibilityFirstStyle()
    {
        var theme = ThemeWith(new SlideTextStyle { Color = "#141210" });

        var rendered = Render(
            new LiveSlide(LiveSlideStatus.ShowingPresentation, ProjectItemType.Song, "item", 0,
                null, null, null, new SongPart("p", null, null, null, SongContent), theme),
            new ActiveOverlay("Welcome", null));

        var overlay = rendered.Find("div.whitespace-pre-line");
        overlay.TextContent.Trim().ShouldBe("Welcome");
        overlay.GetAttribute("style")!.ShouldContain("rgba(255, 255, 255, 0.6)");
        overlay.GetAttribute("style")!.ShouldContain("text-shadow");
    }

    [Fact]
    public void WithoutATheme_FallsBackToClassic()
    {
        // Theme defaults to null on the record, and a public viewer must not get an unstyled slide.
        var rendered = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Song, "item", 0,
            null, null, null, new SongPart("p", null, null, null, SongContent)));

        rendered.Find("div.absolute.inset-0").GetAttribute("style")!.ShouldContain("background-color: #000000");
        rendered.Find("div[style*='font-family']").GetAttribute("style")!.ShouldContain("color: #ffffff");
    }

    private static SlideTheme ThemeWith(SlideTextStyle mainText) =>
        new() { Song = new SlideStyle { MainText = mainText } };

    private IRenderedComponent<PublicSlideView> RenderSongSlide(SlideTheme theme) =>
        Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Song, "item", 0,
            null, Credits, null, new SongPart("p", null, null, null, SongContent), theme));

    private IRenderedComponent<PublicSlideView> Render(LiveSlide slide, ActiveOverlay? overlay = null) =>
        RenderComponent<PublicSlideView>(parameters => parameters
            .Add(p => p.LiveSlide, slide)
            .Add(p => p.Overlay, overlay));
}
