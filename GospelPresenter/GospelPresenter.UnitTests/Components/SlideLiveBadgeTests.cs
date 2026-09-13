using Bunit;
using GospelPresenter.Shared.Components;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The "Live" badge on a slide thumbnail, which is how the operator sees at a glance which tile of
/// the grid the congregation is looking at.
///
/// The badge and the slide canvas are siblings, both positioned and both with an automatic z-index,
/// so document order alone decides which one paints on top. The canvas carries the theme's opaque
/// background, so a badge written before it is present in the markup and invisible on screen — which
/// is exactly what happened: the grid rendered the badge for months while nobody could see it. A
/// test that only asserts the badge exists would have passed throughout, so these tests assert the
/// order as well.
/// </summary>
public class SlideLiveBadgeTests : TestContext
{
    public SlideLiveBadgeTests()
    {
        Services.AddLocalization();
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new Microsoft.Extensions.Options.OptionsWrapper<LocalizationOptions>(new LocalizationOptions()),
                    Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance)));
    }

    [Fact]
    public void Slide_WhenTheSelectedSlideIsLive_ShowsTheBadge()
    {
        var slide = RenderSlide(isSelected: true, isLive: true);

        slide.FindAll("div.bg-red-500").Count.ShouldBe(1);
    }

    /// <summary>The part that was broken: rendered, but underneath an opaque canvas.</summary>
    [Fact]
    public void Slide_WhenTheSelectedSlideIsLive_PaintsTheBadgeOverTheCanvas()
    {
        var slide = RenderSlide(isSelected: true, isLive: true);

        var children = slide.Find("div.select-none").Children;

        children.Length.ShouldBe(2);
        children[0].ClassList.ShouldContain("origin-top-left");
        children[1].ClassList.ShouldContain("bg-red-500");
    }

    [Fact]
    public void Slide_WhenTheSelectedSlideIsNotLive_ShowsNoBadge()
    {
        var slide = RenderSlide(isSelected: true, isLive: false);

        slide.FindAll("div.bg-red-500").ShouldBeEmpty();
    }

    /// <summary>Live, but the operator is looking at another slide: that one is not on the screen.</summary>
    [Fact]
    public void Slide_WhenAnotherSlideIsLive_ShowsNoBadge()
    {
        var slide = RenderSlide(isSelected: false, isLive: true);

        slide.FindAll("div.bg-red-500").ShouldBeEmpty();
    }

    private IRenderedComponent<Slide> RenderSlide(bool isSelected, bool isLive) =>
        RenderComponent<Slide>(p => p
            .Add(c => c.Scale, 0.2)
            .Add(c => c.BaseWidth, 1920)
            .Add(c => c.BaseHeight, 1080)
            .Add(c => c.IsSelected, isSelected)
            .Add(c => c.IsLive, isLive)
            .AddChildContent("<p>Amazing grace</p>"));
}
