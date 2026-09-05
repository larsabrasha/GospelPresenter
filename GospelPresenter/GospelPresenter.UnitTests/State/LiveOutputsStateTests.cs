using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using Microsoft.JSInterop;
using Microsoft.JSInterop.Infrastructure;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

/// <summary>
/// One owner for the outputs this host opened, and why there has to be one.
///
/// The presentation page renders <c>LivePanel</c> twice — a floating panel for narrow layouts and a
/// sidebar for wide ones — and only CSS picks which of the two the operator can see. While each
/// panel kept its own copy of the live windows and the projector output, both of them restored the
/// saved configuration on the way in, so an operator who had one live window open last time got two
/// back; a window opened from the panel they were actually using was registered on the other one and
/// had no row to close it; and whichever panel saved last wrote its own idea of how many windows
/// were open over the other's.
///
/// These tests describe the state object rather than the panels, because that is where the answer
/// now lives. <see cref="SharedServicesSetupTests"/> holds the other half: that both panels get the
/// same instance.
/// </summary>
public class LiveOutputsStateTests
{
    private const string SessionId = "session-1";
    private const string LiveViewTitle = "Live view";
    private const string ProjectorTitle = "Projector";

    private readonly RemoteDisplayState displays = new();
    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240));
    private readonly StubJsRuntime js = new();

    public LiveOutputsStateTests()
    {
        js.Returns("gospelPresenter.isPresentationApiAvailable", false);
        js.Returns("gospelPresenter.openLiveWindow", true);
    }

    private LiveOutputsState Create() => new(liveState, displays, new StubProvider(js));

    private Task AttachAsync(LiveOutputsState state, params RemoteDisplay[] savedDisplays) =>
        state.AttachAsync(SessionId, savedDisplays, LiveViewTitle, ProjectorTitle);

    /// <summary>The bug, stated: two panels attaching restores what was saved once, not twice.</summary>
    [Fact]
    public async Task AttachAsync_CalledOncePerPanel_RestoresTheSavedWindowsOnlyOnce()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, WindowCount: 1, false));
        var state = Create();

        await AttachAsync(state);
        await AttachAsync(state);

        js.CallCount("gospelPresenter.openLiveWindow").ShouldBe(1);
        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// The same for the projector window, which is the one an operator notices: two of them means
    /// two full-screen views fighting over the second display.
    /// </summary>
    [Fact]
    public async Task AttachAsync_CalledOncePerPanel_RestoresTheProjectorOutputOnlyOnce()
    {
        js.Returns("gospelPresenter.isPresentationApiAvailable", true);
        js.Returns("gospelPresenter.startPresentation", 7);
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 0, PresentationDisplay: true));
        var state = Create();

        await AttachAsync(state);
        await AttachAsync(state);

        js.CallCount("gospelPresenter.startPresentation").ShouldBe(1);
        state.IsExternalDisplayOn.ShouldBeTrue();
    }

    /// <summary>
    /// Coming back to a session that is already attached restores nothing either. Navigating away
    /// from a running presentation and back builds new panels, and the windows are still open.
    /// </summary>
    [Fact]
    public async Task AttachAsync_ForASessionAlreadyAttachedTo_RestoresNothingAgain()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        var state = Create();
        await AttachAsync(state);

        await AttachAsync(state);

        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// A window opened by the synchronous JS click path is registered here, where both panels can
    /// see it — the point being that the panel the operator tapped is the one showing the row.
    /// </summary>
    [Fact]
    public async Task OnLiveWindowOpened_FromTheScriptsOwnClickPath_ShowsUpAmongTheWindows()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        var state = Create();
        await AttachAsync(state);

        state.OnLiveWindowOpened("window-1");

        state.Windows.Select(w => w.WindowId).ShouldBe(["window-1"]);
        state.NextWindowIndex.ShouldBe(2);
    }

    /// <summary>
    /// The saved configuration has to survive a save that a JS callback triggered. The panel is the
    /// only thing that knows which outputs the organisation has, so the state keeps that list —
    /// reading an empty one on this path would drop the operator's screens from what is written down.
    /// </summary>
    [Fact]
    public async Task SaveAsync_AfterAWindowOpenedFromTheScript_StillNamesTheEnabledOutputs()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        var screen = new RemoteDisplay { DisplayIdentifier = "screen-1", Name = "Stora salen" };
        displays.EnableDisplay(screen.DisplayIdentifier, SessionId, screen.Name);
        var state = Create();
        await AttachAsync(state, screen);

        state.OnLiveWindowOpened("window-1");
        await state.SaveAsync();

        var saved = js.LastSaved();
        saved.EnabledDisplayIds.ShouldBe(["screen-1"]);
        saved.WindowCount.ShouldBe(1);
    }

    /// <summary>
    /// A closed window leaves the list, so the row offering to close it goes with it. This used to
    /// reach only whichever panel had registered its reference last.
    /// </summary>
    [Fact]
    public async Task OnLiveWindowClosed_ForAWindowThatWasOpen_TakesItOutOfTheList()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        var state = Create();
        await AttachAsync(state);
        var windowId = state.Windows[0].WindowId;

        state.OnLiveWindowClosed(windowId);

        state.Windows.ShouldBeEmpty();
    }

    /// <summary>
    /// A window that could not be opened — a blocked popup, a host with no second window — must not
    /// take a number with it. The number is what the operator reads on the row, and skipping one
    /// left them looking for a "Live view (1)" that was never there.
    /// </summary>
    [Fact]
    public async Task OpenWindowAsync_WhenTheWindowIsBlocked_KeepsTheNumberForTheNextAttempt()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        js.Returns("gospelPresenter.openLiveWindow", false);
        var state = Create();
        await AttachAsync(state);

        (await state.OpenWindowAsync(LiveViewTitle)).ShouldBeFalse();

        state.Windows.ShouldBeEmpty();
        state.NextWindowIndex.ShouldBe(1);
    }

    /// <summary>
    /// The script opens the window itself and reports it afterwards, so the report can land after
    /// the presentation stopped. The window shuts itself once the session is inactive, so tracking
    /// it would leave a row offering to close something that is already gone.
    /// </summary>
    [Fact]
    public async Task OnLiveWindowOpened_ArrivingAfterThePresentationStopped_IsIgnored()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        var state = Create();
        liveState.ActivatePresentation(SessionId, "org-1", "pres-1");
        await AttachAsync(state);
        liveState.DeactivatePresentation(SessionId);

        state.OnLiveWindowOpened("window-1");

        state.Windows.ShouldBeEmpty();
    }

    /// <summary>
    /// A browser that refuses to open the window part way through the restore must not take the
    /// page with it. This runs from the panel's OnParametersSetAsync, so an exception here comes
    /// out of a component lifecycle method and ends the circuit — over an output, which the
    /// operator can switch on by hand.
    /// </summary>
    [Fact]
    public async Task AttachAsync_WhenRestoringAWindowFails_DoesNotTakeThePageDown()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 2, false));
        js.Throws("gospelPresenter.openLiveWindow");
        var state = Create();

        await AttachAsync(state);

        state.Windows.ShouldBeEmpty();
    }

    /// <summary>
    /// And what it did manage to open before failing is still listed, so the row offering to close
    /// it is there.
    /// </summary>
    [Fact]
    public async Task AttachAsync_WhenRestoringFailsPartWay_StillListsWhatOpened()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 2, false));
        js.FailAfter("gospelPresenter.openLiveWindow", calls: 1);
        var state = Create();

        await AttachAsync(state);

        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// The shape the two panels actually attach in. Blazor does not wait for one child's
    /// OnParametersSetAsync before calling the next one's, so the second call lands while the first
    /// is still waiting on the browser — which is the window the guard has to cover, and the reason
    /// it is set before the first await rather than after the restore.
    /// </summary>
    [Fact]
    public async Task AttachAsync_WhenTheSecondPanelArrivesMidFlight_StillRestoresOnlyOnce()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        js.DelayAll();
        var state = Create();

        var narrow = AttachAsync(state);
        var wide = AttachAsync(state);
        await Task.WhenAll(narrow, wide);

        js.CallCount("gospelPresenter.openLiveWindow").ShouldBe(1);
        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// Nothing is attached before a presentation is running, and a click that arrives then must not
    /// invent a window for a session that does not exist.
    /// </summary>
    [Fact]
    public async Task OpenWindowAsync_BeforeAnythingIsAttached_DoesNothing()
    {
        var state = Create();

        (await state.OpenWindowAsync(LiveViewTitle)).ShouldBeFalse();

        js.CallCount("gospelPresenter.openLiveWindow").ShouldBe(0);
    }

    /// <summary>
    /// A presentation can be stopped by something other than the panel showing it: a phone driving
    /// the session, or the session ageing out. The outputs have to let go then too — the windows
    /// shut themselves and report it, and a report that lands on a session still held as running
    /// wrote the operator's saved configuration back as "no windows".
    /// </summary>
    [Fact]
    public async Task PresentationStoppedElsewhere_ThenAWindowReportingItselfClosed_LeavesTheSavedOutputsAlone()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        var state = Create();
        liveState.ActivatePresentation(SessionId, "org-1", "pres-1");
        await AttachAsync(state);
        var windowId = state.Windows[0].WindowId;
        var savesBefore = js.CallCount("gospelPresenter.saveOutputConfig");

        liveState.DeactivatePresentation(SessionId);
        state.OnLiveWindowClosed(windowId);

        js.CallCount("gospelPresenter.saveOutputConfig").ShouldBe(savesBefore);
        js.LastSaved().WindowCount.ShouldBe(1);
    }

    /// <summary>
    /// And the next presentation on the same session gets its outputs back. Holding the session
    /// after it stopped made every start after the first one skip the restore entirely.
    /// </summary>
    [Fact]
    public async Task AttachAsync_AfterThePresentationStopped_RestoresTheSavedOutputsForTheNextOne()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        var state = Create();
        liveState.ActivatePresentation(SessionId, "org-1", "pres-1");
        await AttachAsync(state);

        liveState.DeactivatePresentation(SessionId);
        state.Windows.ShouldBeEmpty();
        await AttachAsync(state);

        state.Windows.Count.ShouldBe(1);
        js.CallCount("gospelPresenter.openLiveWindow").ShouldBe(2);
    }

    /// <summary>Somebody else's session stopping is none of this host's business.</summary>
    [Fact]
    public async Task AnotherSessionStopping_LeavesTheseOutputsAlone()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        var state = Create();
        liveState.ActivatePresentation(SessionId, "org-1", "pres-1");
        await AttachAsync(state);

        liveState.ActivatePresentation("someone-elses-session", "org-1", "pres-2");
        liveState.DeactivatePresentation("someone-elses-session");

        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// The panel attaches before the first render, which on the web is prerendering, where JS
    /// interop throws. Keeping the session after that failure left the panel with no outputs for
    /// the rest of the service, because nothing attaches twice.
    /// </summary>
    [Fact]
    public async Task AttachAsync_WhenTheBrowserCannotBeReachedYet_AttachesOnTheNextTry()
    {
        js.Throws("gospelPresenter.isPresentationApiAvailable");
        var state = Create();
        await AttachAsync(state);

        js.Returns("gospelPresenter.isPresentationApiAvailable", false);
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        await AttachAsync(state);

        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// Only what the container brings: this state resolves the JS runtime on use rather than taking
    /// it as a dependency, so that the migration tool — which shares these registrations and has no
    /// Blazor — still starts. See LiveOutputsState.
    /// </summary>
    private sealed class StubProvider(IJSRuntime js) : IServiceProvider
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(IJSRuntime) ? js : null;
    }

    /// <summary>
    /// Answers the handful of calls this state makes, and remembers what it was asked. Void calls
    /// arrive as <see cref="IJSVoidResult"/>, which is what InvokeVoidAsync compiles down to.
    /// </summary>
    private sealed class StubJsRuntime : IJSRuntime
    {
        private readonly Dictionary<string, object?> answers = new();
        private readonly HashSet<string> failing = [];
        private readonly Dictionary<string, int> failAfter = new();
        private readonly List<(string Identifier, object?[]? Args)> calls = [];

        public void Returns(string identifier, object? value)
        {
            answers[identifier] = value;
            failing.Remove(identifier);
        }

        public void Throws(string identifier) => failing.Add(identifier);

        /// <summary>Answers normally this many times, then starts failing.</summary>
        public void FailAfter(string identifier, int calls) => failAfter[identifier] = calls;

        /// <summary>
        /// Makes every call finish asynchronously, the way a real interop round trip does. Without
        /// it a stub answers inline and a caller never actually yields, so a guard that only works
        /// because nothing interleaved would pass.
        /// </summary>
        public void DelayAll() => delay = true;

        private bool delay;

        public int CallCount(string identifier) => calls.Count(c => c.Identifier == identifier);

        public LiveOutputsConfig LastSaved() =>
            (LiveOutputsConfig)calls.Last(c => c.Identifier == "gospelPresenter.saveOutputConfig").Args![0]!;

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args)
        {
            calls.Add((identifier, args));

            if (failAfter.TryGetValue(identifier, out var remaining))
            {
                if (remaining <= 0) throw new InvalidOperationException("The browser refused.");
                failAfter[identifier] = remaining - 1;
            }

            if (failing.Contains(identifier))
                throw new InvalidOperationException(
                    "JavaScript interop calls cannot be issued during server-side prerendering.");

            var value = typeof(TValue) == typeof(IJSVoidResult)
                ? default!
                : (TValue)answers.GetValueOrDefault(identifier)!;

            return delay
                ? new ValueTask<TValue>(Task.Run(async () =>
                {
                    await Task.Yield();
                    return value;
                }))
                : new ValueTask<TValue>(value);
        }

        public ValueTask<TValue> InvokeAsync<TValue>(
            string identifier, CancellationToken cancellationToken, object?[]? args) =>
            InvokeAsync<TValue>(identifier, args);
    }
}
