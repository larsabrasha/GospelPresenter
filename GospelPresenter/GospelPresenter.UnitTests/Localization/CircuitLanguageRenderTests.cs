using System.ComponentModel;
using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.State;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Localization;

/// <summary>
/// What a page looks like when somebody else's thread repaints it.
///
/// SharedAppState is a singleton with a synchronous PropertyChanged, and every open page subscribes.
/// The writer is not always the viewer: the device owning the session echoes a slide change back
/// through the live hub, an announcement timer fires, another operator's circuit changes a theme.
/// The subscribing page answers with InvokeAsync(StateHasChanged), which carries the writer's
/// ExecutionContext — and CultureInfo travels in it. A device sends no culture cookie and no
/// Accept-Language, so its context holds the default language, and the operator's page repaints in
/// it. Every string changes at once, which is why it reads as the whole UI flashing.
///
/// The component below is the smallest thing shaped like Presentation.razor: it listens to the
/// singleton, renders a localized string and a formatted number, and dispatches with
/// Culture.Restore the way the real handlers do.
/// </summary>
public class CircuitLanguageRenderTests : TestContext
{
    private const string Swedish = "Ladda om";
    private const string English = "Reload";
    private const string SwedishNumber = "1,5";
    private const string EnglishNumber = "1.5";
    private const string SessionId = "session-1";

    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    public CircuitLanguageRenderTests()
    {
        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        Services.AddSingleton(liveState);
        Services.AddSingleton(circuit);
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    /// <summary>Guards the tests below: they prove nothing unless the page starts out Swedish.</summary>
    [Fact]
    public void APageInASwedishCircuit_RendersInSwedish()
    {
        RenderComponent<PageRestoringTheCircuitsCulture>().Markup.ShouldContain(Swedish);
    }

    /// <summary>The reported symptom: the whole page repainting in the wrong language.</summary>
    [Fact]
    public async Task APageRepaintedFromAnEnglishThread_KeepsItsSwedishText()
    {
        var page = RenderComponent<PageRestoringTheCircuitsCulture>();

        await RaiseLiveStateChangeFromAThreadSpeaking("en");

        page.Markup.ShouldContain(Swedish);
    }

    /// <summary>
    /// The half the localizer cannot reach. Numbers, dates and sorting come from CurrentCulture, so
    /// the dispatch itself has to carry the circuit's culture — not only the string lookups.
    /// </summary>
    [Fact]
    public async Task APageRepaintedFromAnEnglishThread_KeepsItsSwedishNumberFormat()
    {
        var page = RenderComponent<PageRestoringTheCircuitsCulture>();

        await RaiseLiveStateChangeFromAThreadSpeaking("en");

        page.Markup.ShouldContain(SwedishNumber);
    }

    /// <summary>
    /// Proves the two tests above are actually sensitive to the fix rather than passing because the
    /// render happened somewhere convenient. The same page without Culture.Restore takes the
    /// writer's language, which is the bug this whole file exists for.
    /// </summary>
    [Fact]
    public async Task APageThatDoesNotRestoreItsCulture_TakesTheWritersNumberFormat()
    {
        var page = RenderComponent<PageInheritingTheWritersCulture>();

        await RaiseLiveStateChangeFromAThreadSpeaking("en");

        page.Markup.ShouldContain(EnglishNumber);
    }

    /// <summary>
    /// Somebody else's thread moving the presentation on. The slide has to differ from the one
    /// before: SharedAppState announces a change only when there is one, so writing the same slide
    /// twice would leave the page untouched and these tests asserting nothing.
    /// </summary>
    private Task RaiseLiveStateChangeFromAThreadSpeaking(string language) =>
        Task.Run(() =>
        {
            var culture = new CultureInfo(language);
            CultureInfo.CurrentCulture = culture;
            CultureInfo.CurrentUICulture = culture;
            liveState.SetLiveSlide(
                SessionId,
                SharedAppState.DefaultSlide with { Text = $"slide {++slidesWritten}" });
        });

    private int slidesWritten;

    /// <summary>Shaped like the handlers in Presentation.razor, Display.razor and Live.razor.</summary>
    private sealed class PageRestoringTheCircuitsCulture : PageListeningToLiveState
    {
        protected override void Dispatch() => _ = InvokeAsync(Culture.Restore(StateHasChanged));
    }

    /// <summary>The same page as it was before this fix.</summary>
    private sealed class PageInheritingTheWritersCulture : PageListeningToLiveState
    {
        protected override void Dispatch() => _ = InvokeAsync(StateHasChanged);
    }

    private abstract class PageListeningToLiveState : ComponentBase, IDisposable
    {
        [Inject] public SharedAppState LiveState { get; set; } = default!;
        [Inject] public IStringLocalizer<SharedResource> L { get; set; } = default!;
        [Inject] public CircuitCulture Culture { get; set; } = default!;

        protected abstract void Dispatch();

        protected override void OnInitialized() => LiveState.PropertyChanged += OnLiveStateChanged;

        private void OnLiveStateChanged(object? sender, PropertyChangedEventArgs e) => Dispatch();

        protected override void BuildRenderTree(RenderTreeBuilder builder)
        {
            builder.OpenElement(0, "p");
            builder.AddContent(1, L["MainLayout.Reload"].Value);
            builder.AddContent(2, " ");
            builder.AddContent(3, 1.5.ToString());
            builder.CloseElement();
        }

        public void Dispose() => LiveState.PropertyChanged -= OnLiveStateChanged;
    }
}
