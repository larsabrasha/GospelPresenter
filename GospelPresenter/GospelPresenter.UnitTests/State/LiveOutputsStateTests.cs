using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
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

    private LiveOutputsState Create(ILiveWindowLauncher? launcher = null) =>
        new(liveState, displays, new StubProvider(js, launcher));

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

        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));

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

        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));
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

        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));

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
    /// The other half of the same bug, and the one an operator actually hit: this object dies with
    /// the circuit and the windows do not. Reload the operator page mid-service and the session is
    /// still running, the live window is still open — and restoring the saved configuration opened a
    /// second one on top of it, listed only the second, and left the first with no row to close it.
    /// </summary>
    [Fact]
    public async Task AttachAsync_WithAWindowAlreadyOpenForTheSession_AdoptsItRatherThanOpeningAnother()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        js.Returns("gospelPresenter.discoverLiveWindows", new[] { LiveWindow("already-open", index: 1) });
        var state = Create();

        await AttachAsync(state);

        js.CallCount("gospelPresenter.openLiveWindow").ShouldBe(0);
        state.Windows.Select(w => w.WindowId).ShouldBe(["already-open"]);
    }

    /// <summary>
    /// And it keeps the number the window was opened with. The operator reads that number off the
    /// row to know which screen they are closing, so renumbering from one would point at the wrong
    /// window — and the next window opened has to continue past it rather than collide with it.
    /// </summary>
    [Fact]
    public async Task AttachAsync_AdoptingAWindow_KeepsItsNumberAndCountsOnFromThere()
    {
        js.Returns("gospelPresenter.discoverLiveWindows", new[] { LiveWindow("already-open", index: 3) });
        var state = Create();

        await AttachAsync(state);

        state.Windows[0].Index.ShouldBe(3);
        state.NextWindowIndex.ShouldBe(4);
    }

    /// <summary>
    /// A projector comes back as the projector. It travels as a role in the window's own URL for
    /// exactly this: adopted without one it would come home as an ordinary live view, giving the
    /// operator a numbered row for their projector and a projector toggle that said "off".
    /// </summary>
    [Fact]
    public async Task AttachAsync_WithAProjectorAlreadyOpen_AdoptsItAsTheProjector()
    {
        var launcher = new StubLauncher { HasExternalDisplay = true };
        launcher.AlreadyOpen(Projector("projector-1"));
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 0, PresentationDisplay: true));
        var state = Create(launcher);

        await AttachAsync(state);

        state.IsExternalDisplayOn.ShouldBeTrue();
        state.Windows.ShouldBeEmpty();
        launcher.Opened.ShouldBeEmpty();
    }

    /// <summary>Somebody else's session is somebody else's windows.</summary>
    [Fact]
    public async Task AttachAsync_WithAWindowOpenForAnotherSession_LeavesItAloneAndRestoresAsUsual()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        js.Returns("gospelPresenter.discoverLiveWindows",
            new[] { LiveWindow("someone-elses", index: 1) with { SessionId = "another-session" } });
        var state = Create();

        await AttachAsync(state);

        state.Windows.Count.ShouldBe(1);
        state.Windows[0].WindowId.ShouldNotBe("someone-elses");
    }

    /// <summary>
    /// Asking who is out there can fail — an old script, a browser without the channel. Then it is
    /// the saved configuration again, which is where this started: worse than one window too many
    /// would be a service with no projector because a question went unanswered.
    /// </summary>
    [Fact]
    public async Task AttachAsync_WhenNobodyCanBeAsked_FallsBackToRestoringWhatWasSaved()
    {
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 1, false));
        js.Throws("gospelPresenter.discoverLiveWindows");
        var state = Create();

        await AttachAsync(state);

        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// A live window that was refreshed says so, and gets its row back. Refreshing fires the page's
    /// own "I am going away" first, so without the announcement on the way back in the operator was
    /// left with a window nothing could close and a panel that swore nothing was open.
    /// </summary>
    [Fact]
    public async Task OnLiveWindowOpened_ForAWindowThatReportedItselfClosedAndCameBack_ListsItAgain()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        var state = Create();
        await AttachAsync(state);
        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));

        state.OnLiveWindowClosed("window-1");
        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));

        state.Windows.Select(w => w.WindowId).ShouldBe(["window-1"]);
    }

    /// <summary>
    /// Every live window announces itself on load, and the one the click path just opened announces
    /// itself too. The same window twice is one row, not two.
    /// </summary>
    [Fact]
    public async Task OnLiveWindowOpened_TwiceForTheSameWindow_ListsItOnce()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        var state = Create();
        await AttachAsync(state);

        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));
        state.OnLiveWindowOpened(LiveWindow("window-1", index: 1));

        state.Windows.Count.ShouldBe(1);
    }

    /// <summary>
    /// Stopping the presentation shuts the windows rather than trusting each of them to notice. A
    /// window only closes itself while its own circuit is alive, and a projector on a machine that
    /// had gone to sleep sat there showing the last slide of a service that had ended.
    /// </summary>
    [Fact]
    public async Task PresentationStopped_ClosesTheWindowsOpenForThatSession()
    {
        var launcher = new StubLauncher();
        launcher.AlreadyOpen(LiveWindow("window-1", index: 1));
        var state = Create(launcher);
        liveState.ActivatePresentation(SessionId, "org-1", "pres-1");
        await AttachAsync(state);

        liveState.DeactivatePresentation(SessionId);

        launcher.Closed.ShouldBe(["window-1"]);
        state.Windows.ShouldBeEmpty();
    }

    /// <summary>
    /// On the web the same order goes out by session rather than by window id, which also reaches
    /// windows this circuit never opened and knows nothing about — the case where nothing else would.
    /// </summary>
    [Fact]
    public async Task PresentationStopped_OnTheWeb_TellsEveryWindowOfTheSessionToClose()
    {
        js.Returns("gospelPresenter.loadOutputConfig", (LiveOutputsConfig?)null);
        var state = Create();
        liveState.ActivatePresentation(SessionId, "org-1", "pres-1");
        await AttachAsync(state);

        liveState.DeactivatePresentation(SessionId);
        await Task.Yield();

        js.CallCount("gospelPresenter.closeLiveWindowsFor").ShouldBe(1);
    }

    /// <summary>
    /// Switching the projector off writes it down as off. The window reports itself closed
    /// asynchronously, so the save used to run first and record it as still on — and the next
    /// presentation dutifully opened a projector the operator had just switched off.
    /// </summary>
    [Fact]
    public async Task ToggleExternalDisplayAsync_SwitchingTheProjectorOff_SavesItAsOff()
    {
        var launcher = new StubLauncher { HasExternalDisplay = true };
        js.Returns("gospelPresenter.loadOutputConfig", new LiveOutputsConfig(null, 0, PresentationDisplay: true));
        var state = Create(launcher);
        await AttachAsync(state);
        state.IsExternalDisplayOn.ShouldBeTrue();

        await state.ToggleExternalDisplayAsync(ProjectorTitle);

        state.IsExternalDisplayOn.ShouldBeFalse();
        js.LastSaved().PresentationDisplay.ShouldBe(false);
    }

    /// <summary>
    /// The projector can be unplugged mid-service. The host then stops offering a second display
    /// while the window is still open — on the operator's own screen now — so switching it off has
    /// to keep working, and must not be read as "switch a new one on".
    /// </summary>
    [Fact]
    public async Task ToggleExternalDisplayAsync_AfterTheSecondDisplayWentAway_StillClosesTheProjector()
    {
        var launcher = new StubLauncher { HasExternalDisplay = false };
        launcher.AlreadyOpen(Projector("projector-1"));
        var state = Create(launcher);
        await AttachAsync(state);
        state.IsExternalDisplayOn.ShouldBeTrue();

        await state.ToggleExternalDisplayAsync(ProjectorTitle);

        launcher.Closed.ShouldBe(["projector-1"]);
        state.IsExternalDisplayOn.ShouldBeFalse();
        launcher.Opened.ShouldBeEmpty();
    }

    private static LiveWindowEntry LiveWindow(string windowId, int index) =>
        new(SessionId, windowId, $"Live view ({index})", LiveWindowRole.Live, index);

    private static LiveWindowEntry Projector(string windowId) =>
        new(SessionId, windowId, ProjectorTitle, LiveWindowRole.Projector, Index: 0);

    /// <summary>
    /// A native host's launcher: it owns the windows, it outlives the circuit that asked for them,
    /// and it is therefore what an operator page coming back from a reload asks.
    /// </summary>
    private sealed class StubLauncher : ILiveWindowLauncher
    {
        private readonly List<LiveWindowEntry> open = [];

        public bool HasExternalDisplay { get; init; }

        public List<string> Opened { get; } = [];

        public List<string> Closed { get; } = [];

        public event Action<string>? WindowClosed;

        /// <summary>A window from before this circuit existed.</summary>
        public void AlreadyOpen(LiveWindowEntry window) => open.Add(window);

        public Task<bool> OpenAsync(LiveWindowEntry window)
        {
            Opened.Add(window.WindowId);
            open.Add(window);
            return Task.FromResult(true);
        }

        public Task CloseAsync(string windowId)
        {
            Closed.Add(windowId);
            if (open.RemoveAll(w => w.WindowId == windowId) > 0)
                WindowClosed?.Invoke(windowId);

            return Task.CompletedTask;
        }

        public IReadOnlyList<LiveWindowEntry> OpenWindowsFor(string sessionId) =>
            open.Where(w => w.SessionId == sessionId).ToList();

        public Task<bool> HasExternalDisplayAsync() => Task.FromResult(HasExternalDisplay);
    }

    /// <summary>
    /// Only what the container brings: this state resolves the JS runtime on use rather than taking
    /// it as a dependency, so that the migration tool — which shares these registrations and has no
    /// Blazor — still starts. See LiveOutputsState.
    /// </summary>
    private sealed class StubProvider(IJSRuntime js, ILiveWindowLauncher? launcher) : IServiceProvider
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(IJSRuntime) ? js
            : serviceType == typeof(ILiveWindowLauncher) ? launcher
            : null;
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
