using Bunit;
using GospelPresenter.Shared.Components.Presentations;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// What the projector, the operator's preview and stage mode all render. The theme travels on the live slide
/// and each slide type has to pick its own block out of it; picking the wrong one, or dropping the theme on
/// the way through, is invisible until a service is running.
/// </summary>
public class LiveSlideViewTests : TestContext
{
    private static readonly SlideTheme Theme = new()
    {
        Song = new SlideStyle
        {
            Background = new SlideBackground { Color = "#0b1b3a" },
            MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Inter },
            Credits = new SlideTextStyle { FontSize = 40, Color = "rgba(1, 1, 1, 0.4)" }
        },
        BibleText = new SlideStyle
        {
            Background = new SlideBackground { Color = "#faf7f2" },
            MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Merriweather, Color = "#141210" }
        },
        Media = new SlideBackground { Color = "#123456" }
    };

    public LiveSlideViewTests()
    {
        Services.AddLocalization();
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new Microsoft.Extensions.Options.OptionsWrapper<LocalizationOptions>(new LocalizationOptions()),
                    Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance)));
    }

    [Fact]
    public void SongSlide_UsesTheSongBlock()
    {
        var markup = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Song, "item", 0,
            null, "John Newton · 1779", null,
            new SongPart("p", null, null, null, "Amazing grace"), Theme)).Markup;

        markup.ShouldContain("background-color: #0b1b3a");
        markup.ShouldContain("'Inter'");
        markup.ShouldContain("rgba(1, 1, 1, 0.4)");
    }

    [Fact]
    public void BibleSlide_UsesTheBibleBlock()
    {
        var markup = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.BibleText, "item", 0,
            "<div>For God so loved the world</div>", null, null, null, Theme)).Markup;

        markup.ShouldContain("background-color: #faf7f2");
        markup.ShouldContain("'Merriweather'");
        markup.ShouldContain("color: #141210");
        markup.ShouldNotContain("'Inter'");
    }

    /// <summary>An image fills the canvas itself; the theme only paints what shows around it.</summary>
    [Fact]
    public void ImageSlide_UsesTheMediaBackground()
    {
        var rendered = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Image, "item", 0,
            null, null, "/api/live-images/s/org-image/1/full", null, Theme));

        rendered.Markup.ShouldContain("background-color: #123456");
        rendered.Find("img").GetAttribute("src").ShouldBe("/api/live-images/s/org-image/1/full");
    }

    /// <summary>
    /// bg-black was removed from the slide's classes so the theme can paint the canvas. If it came back, a
    /// light theme would render black behind its own background.
    /// </summary>
    [Fact]
    public void Slide_DoesNotPaintItsOwnBlackBackground()
    {
        var markup = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.BibleText, "item", 0,
            "<div>Text</div>", null, null, null, Theme)).Markup;

        markup.ShouldNotContain("bg-black");
        markup.ShouldNotContain("text-white\"");
    }

    [Fact]
    public void WithoutATheme_FallsBackToClassic()
    {
        var markup = Render(new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Song, "item", 0,
            null, null, null, new SongPart("p", null, null, null, "Amazing grace"))).Markup;

        markup.ShouldContain("background-color: #000000");
        markup.ShouldContain("color: #ffffff");
        markup.ShouldContain("font-size: 85px");
    }

    private IRenderedComponent<LiveSlideView> Render(LiveSlide slide) =>
        RenderComponent<LiveSlideView>(parameters => parameters
            .Add(p => p.LiveSlide, slide)
            .Add(p => p.BaseWidth, 1920)
            .Add(p => p.BaseHeight, 1080)
            .Add(p => p.Scale, 0.5));
}
