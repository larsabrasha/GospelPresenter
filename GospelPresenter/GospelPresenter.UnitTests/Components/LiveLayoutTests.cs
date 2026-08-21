using Bunit;
using GospelPresenter.Shared.Layout;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The layout behind /live and /display — a projector or a TV with a congregation looking at it.
/// Nothing here may draw a connection or error message: those belong on the operator's own screen,
/// and the whole point of the arrangement is that a failing circuit leaves the last slide standing
/// instead of a yellow bar with a Reload button. Easy to undo by pasting MainLayout's error block
/// back in, and impossible to notice until it happens in front of people.
/// </summary>
public class LiveLayoutTests : TestContext
{
    // The real implementation lives in the web host, which the tests do not reference.
    private sealed class FlatStatusBar : IStatusBarService
    {
        public int GetStatusBarHeight() => 0;
    }

    public LiveLayoutTests()
    {
        JSInterop.Mode = JSRuntimeMode.Loose;
        Services.AddLogging();
        Services.AddSingleton<IStatusBarService>(new FlatStatusBar());
        Services.AddSingleton(new AppState());
        Services.AddLocalization();
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new Microsoft.Extensions.Options.OptionsWrapper<LocalizationOptions>(new LocalizationOptions()),
                    NullLoggerFactory.Instance)));
    }

    private IRenderedComponent<LiveLayout> RenderLayout() =>
        RenderComponent<LiveLayout>(parameters => parameters
            .Add(p => p.Body, builder => builder.AddMarkupContent(0, "<p>slide</p>")));

    [Fact]
    public void RendersTheBody()
    {
        RenderLayout().Markup.ShouldContain("<p>slide</p>");
    }

    [Fact]
    public void HasNoBlazorErrorUi()
    {
        RenderLayout().FindAll("#blazor-error-ui").ShouldBeEmpty();
    }

    [Fact]
    public void ShowsNothingAboutTheConnection()
    {
        var markup = RenderLayout().Markup;

        // The framework's own reconnection dialog is neutralised in app.css via the output-surface
        // class, so this only guards against the layout growing a message of its own.
        markup.ShouldNotContain("components-reconnect");
        markup.ShouldNotContain("MainLayout.UnexpectedError");
        markup.ShouldNotContain("MainLayout.Reload");
    }
}
