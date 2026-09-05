using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Components.Presentations;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The live panel as the presentation page actually renders it: twice. One panel floats over the
/// slide grid on a narrow screen and one is the sidebar on a wide one, and only CSS decides which
/// the operator can see — so anything a panel owns by itself exists twice, and the two copies
/// disagree the moment either changes.
///
/// The outputs are the part where that was visible, and these tests hold the two rules that came
/// out of it: the panels share one owner for what this host has opened, and a panel that is only
/// controlling somebody else's session does not offer to manage their outputs or to stop them.
/// </summary>
public class LivePanelRenderTests : TestContext, IDisposable
{
    private const string SessionId = "session-1";

    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    public LivePanelRenderTests()
    {
        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        Services.AddSingleton(circuit);
        Services.AddSingleton(liveState);
        Services.AddSingleton<RemoteDisplayState>();
        Services.AddSingleton(new PublicOutputState(500));
        Services.AddSingleton<IAppCapabilities, FullAppCapabilities>();
        Services.AddSingleton<ToastService>();
        Services.AddSingleton<LiveOutputsState>();
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));

        // The panel talks to the browser for windows and local storage. Loose so the calls that
        // only have side effects need no plan; the two that return something are planned below.
        JSInterop.Mode = JSRuntimeMode.Loose;
        JSInterop.Setup<bool>("gospelPresenter.isPresentationApiAvailable").SetResult(false);
        JSInterop.Setup<bool>("gospelPresenter.openLiveWindow", _ => true).SetResult(true);
    }

    /// <summary>
    /// The bug this was written for: an operator who had one live window open last time got two
    /// back, because both panels restored the saved configuration on the way in.
    /// </summary>
    [Fact]
    public void TwoPanels_WithOneLiveWindowSavedFromLastTime_ReopenOneWindowBetweenThem()
    {
        SaveConfig(new LiveOutputsConfig(null, WindowCount: 1, false));

        RenderPanel();
        RenderPanel();

        JSInterop.Invocations["gospelPresenter.openLiveWindow"].Count.ShouldBe(1);
    }

    /// <summary>
    /// And both panels show a window opened after they were rendered, because they read the same
    /// list. While each kept its own, a window opened from the panel the operator was using was
    /// registered on the other one and had no row offering to close it.
    /// </summary>
    [Fact]
    public async Task TwoPanels_WhenAWindowIsOpened_BothShowARowForIt()
    {
        SaveConfig(new LiveOutputsConfig(null, 0, false));
        var narrow = RenderPanel();
        var wide = RenderPanel();

        await Services.GetRequiredService<LiveOutputsState>().OpenWindowAsync("Fönster");

        narrow.WaitForAssertion(() => narrow.Markup.ShouldContain("Fönster (1)"));
        wide.WaitForAssertion(() => wide.Markup.ShouldContain("Fönster (1)"));
    }

    /// <summary>
    /// Outputs belong to the machine that is presenting. A controller's toggle wrote a binding on
    /// somebody else's session — from its own saved configuration, no less — and a mirrored owner's
    /// next report put its own set straight back. See adr/0004.
    /// </summary>
    [Fact]
    public void Panel_ControllingSomebodyElsesSession_DoesNotOfferTheirOutputs()
    {
        SaveConfig(new LiveOutputsConfig(null, 1, false));

        var panel = RenderPanel(isRemoteController: true);

        panel.Markup.ShouldNotContain("Utgångar");
        JSInterop.Invocations["gospelPresenter.openLiveWindow"].ShouldBeEmpty();
    }

    [Fact]
    public void Panel_ForThisMachinesOwnSession_OffersItsOutputs()
    {
        RenderPanel().Markup.ShouldContain("Utgångar");
    }

    /// <summary>
    /// A stop that cannot reach the projector is not offered as a button. Pressing it looked as if
    /// it had worked — the panel went away — while the presentation carried on and the owner's next
    /// report put the session back.
    /// </summary>
    [Fact]
    public void Panel_ThatMayNotStopThePresentation_SaysSoInsteadOfOfferingTheButton()
    {
        var panel = RenderPanel(isRemoteController: true, canStop: false);

        panel.Markup.ShouldContain("Bara datorn som presenterar kan stoppa presentationen.");
        panel.FindAll("button").Any(b => b.GetAttribute("title") == "Avsluta presentation").ShouldBeFalse();
    }

    [Fact]
    public void Panel_ThatMayStopThePresentation_OffersTheButton()
    {
        var panel = RenderPanel();

        panel.FindAll("button").Any(b => b.GetAttribute("title") == "Avsluta presentation").ShouldBeTrue();
    }

    private void SaveConfig(LiveOutputsConfig config) =>
        JSInterop.Setup<LiveOutputsConfig?>("gospelPresenter.loadOutputConfig").SetResult(config);

    private IRenderedComponent<LivePanel> RenderPanel(bool isRemoteController = false, bool canStop = true) =>
        RenderComponent<LivePanel>(p => p
            .Add(c => c.LiveSlide, SharedAppState.DefaultSlide)
            .Add(c => c.Scale, 0.2)
            .Add(c => c.BaseWidth, 1920)
            .Add(c => c.BaseHeight, 1080)
            .Add(c => c.OverlaySlides, [])
            .Add(c => c.SessionId, SessionId)
            .Add(c => c.SavedDisplays, [])
            .Add(c => c.IsRemoteController, isRemoteController)
            .Add(c => c.CanStop, canStop));

    public new void Dispose() => base.Dispose();
}
