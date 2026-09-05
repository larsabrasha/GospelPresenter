using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;

namespace GospelPresenter.Shared.State;

/// <summary>One live window this host opened, and the number the operator sees next to it.</summary>
public record LiveWindowEntry(string WindowId, int Index);

/// <summary>
/// What was on last time, as it is written to this browser's local storage. Public because it is
/// the shape both the JS side and the tests have to agree on, not an implementation detail of the
/// state object.
/// </summary>
/// <param name="PresentationDisplay">
/// One flag for the one projector output, whichever mechanism drives it — a machine that gained or
/// lost a second display since last time restores whatever it can do now.
/// </param>
public record LiveOutputsConfig(string[]? EnabledDisplayIds, int? WindowCount, bool? PresentationDisplay);

/// <summary>
/// The outputs this host owns for the running session: the live windows it opened, the projector
/// window on a second screen, and the saved configuration that puts them back next time.
///
/// Scoped, and deliberately not held by the panel that shows it. <c>LivePanel</c> is rendered
/// twice on the presentation page — once for narrow layouts and once for the sidebar — and only
/// CSS decides which of the two the operator can see. Each instance used to keep its own copy of
/// this, which made every one of these a state that could be wrong: restoring a saved
/// configuration opened two live windows and two projector windows instead of one, a window
/// opened from the narrow panel was registered on the wide one and could not be closed from the
/// panel that opened it, and whichever panel saved last overwrote the other's idea of how many
/// windows were open.
///
/// The bindings for paired screens and public outputs are not here: those live in
/// <see cref="RemoteDisplayState"/>, which is a singleton and therefore already one answer. Only
/// what belongs to this browser or this app window needs an owner of its own.
/// </summary>
public class LiveOutputsState : IDisposable
{
    private readonly SharedAppState sharedAppState;
    private readonly IServiceProvider services;
    private readonly RemoteDisplayState remoteDisplayState;
    private readonly ILiveWindowLauncher? launcher;
    private IJSRuntime? jsRuntime;

    private readonly List<LiveWindowEntry> windows = [];
    private readonly List<int> presentationDisplays = [];

    private string? sessionId;
    private bool attaching;
    private IReadOnlyList<RemoteDisplay> savedDisplays = [];
    private DotNetObjectReference<LiveOutputsState>? selfRef;
    private string? externalWindowId;

    public LiveOutputsState(
        SharedAppState sharedAppState, RemoteDisplayState remoteDisplayState, IServiceProvider services)
    {
        this.sharedAppState = sharedAppState;
        this.services = services;
        this.remoteDisplayState = remoteDisplayState;
        // Only the native hosts register one; the web keeps its synchronous window.open path.
        launcher = services.GetService<ILiveWindowLauncher>();
        if (launcher is not null)
            launcher.WindowClosed += OnNativeWindowClosed;

        // Followed rather than being told by the page. A presentation stops in more ways than the
        // Stop button — a phone driving the session, the session ageing out — and every one of them
        // has to let go of the outputs. Doing it from the button covered one, and left the others
        // holding a session that was over: the live windows then shut themselves, reported it to a
        // state that still believed it was presenting, and the report wrote the operator's saved
        // outputs back as "nothing was open".
        sharedAppState.PresentationDeactivated += OnPresentationDeactivated;
    }

    /// <summary>
    /// Asked for on use rather than taken as a constructor parameter, because the shared
    /// registrations are also used by the migration tool, which has no Blazor and no JS runtime.
    /// A declared dependency there would be constructed by the container's build-time validation
    /// and stop a host that never renders a live panel from starting at all.
    /// </summary>
    private IJSRuntime js => jsRuntime ??= services.GetRequiredService<IJSRuntime>();

    /// <summary>Raised when anything here changed, so both panels repaint from one answer.</summary>
    public event Action? Changed;

    /// <summary>
    /// A snapshot, replaced on change rather than handed out live. Two components enumerate this
    /// while a native host's WindowClosed can remove from it on a thread of its own, and a render
    /// that caught that mid-removal would throw rather than repaint.
    /// </summary>
    public IReadOnlyList<LiveWindowEntry> Windows { get; private set; } = [];

    /// <summary>The number the next live window gets. Rendered into the JS click path's markup.</summary>
    public int NextWindowIndex { get; private set; } = 1;

    /// <summary>
    /// Whether the host can put a window on a display the operator is not working on. Answered by
    /// the host where there is one, and by the browser's Presentation API otherwise.
    /// </summary>
    public bool HasNativeExternalDisplay { get; private set; }

    public bool HasPresentationApi { get; private set; }

    /// <summary>
    /// Whether this host opens live windows itself. The web has no launcher and must go through the
    /// synchronous JS click path instead, because Safari blocks a popup opened after an await.
    /// </summary>
    public bool HasNativeLauncher => launcher is not null;

    public bool IsExternalDisplayOn => presentationDisplays.Count > 0 || externalWindowId is not null;

    /// <summary>
    /// Takes ownership of the outputs for a session, restoring what was saved last time. The first
    /// caller does the work and the second is a no-op: the two panels attach independently, and
    /// restoring twice is what opened everything twice.
    /// </summary>
    public async Task AttachAsync(string sessionId, IReadOnlyList<RemoteDisplay> savedDisplays, string localLiveViewTitle, string externalDisplayTitle)
    {
        Track(savedDisplays);

        // Both panels reach this in the same render pass, before either has awaited anything, so
        // the guards have to be set before the first await: `attaching` covers the window while
        // the first is restoring, and the session id covers every call after that. A panel coming
        // back to a session already attached to must not restore a second time.
        if (this.sessionId == sessionId || attaching) return;
        attaching = true;
        this.sessionId = sessionId;

        try
        {
            selfRef ??= DotNetObjectReference.Create(this);
            HasNativeExternalDisplay = launcher is not null && await launcher.HasExternalDisplayAsync();
            HasPresentationApi = !HasNativeExternalDisplay
                                 && await js.InvokeAsync<bool>("gospelPresenter.isPresentationApiAvailable");

            // One listener and one reference, whatever the panel count. Registering these per panel
            // left the JS click path reporting an opened window to whichever panel happened to be
            // rendered last, which was never the narrow one the operator had tapped.
            await js.InvokeVoidAsync("gospelPresenter.onLiveWindowClosed", selfRef);
            await js.InvokeVoidAsync("gospelPresenter.setLivePanelRef", selfRef);
        }
        catch
        {
            // The panel attaches from OnParametersSetAsync, which on the web runs before the first
            // render — where JS interop is not available yet. Let the session go rather than keep a
            // half-attached one: the next parameters-set is the interactive render, and it attaches
            // properly. Held, this left the panel showing no outputs at all for the whole service.
            this.sessionId = null;
            attaching = false;
            return;
        }

        try
        {
            await RestoreAsync(localLiveViewTitle, externalDisplayTitle);
        }
        catch
        {
            // Whatever it managed to open is open and is listed below; the rest is lost until the
            // next presentation. Letting it out would come back out of the panel's
            // OnParametersSetAsync and take the circuit down with it, and the outputs are the least
            // important thing on this page — the operator can switch them on by hand.
        }
        finally
        {
            // Kept attached either way: whatever is open is open, and attaching again would open
            // those a second time.
            attaching = false;
        }

        Changed?.Invoke();
    }

    /// <summary>
    /// The outputs the organisation has configured, as the panel currently knows them. Kept here so
    /// that a save triggered from a JS callback writes the same set as one triggered by a click:
    /// reading an empty list on those paths is what silently dropped the operator's screens from
    /// the saved configuration.
    /// </summary>
    public void Track(IReadOnlyList<RemoteDisplay> displays) => savedDisplays = displays;

    private void OnPresentationDeactivated(string stoppedSessionId)
    {
        if (stoppedSessionId != sessionId) return;
        Reset();
    }

    /// <summary>
    /// Forgets the session without touching what is open, and without writing anything down. The
    /// live windows close themselves once the session is inactive, and the saved configuration is
    /// what puts them back next time — saving here would record the empty state and lose the
    /// operator's outputs for good.
    ///
    /// Runs on the same call stack as the deactivation, which is what makes it safe: the windows
    /// report themselves closed asynchronously, so by the time they do there is no session left for
    /// their report to write against.
    /// </summary>
    private void Reset()
    {
        sessionId = null;
        attaching = false;
        windows.Clear();
        Windows = [];
        presentationDisplays.Clear();
        externalWindowId = null;
        NextWindowIndex = 1;
        Changed?.Invoke();
    }

    /// <summary>Opens a live window. False when it could not be opened, so the caller can say so.</summary>
    public async Task<bool> OpenWindowAsync(string titlePrefix)
    {
        if (sessionId is not { } session) return false;

        var windowId = Guid.NewGuid().ToString("N")[..8];
        var index = NextWindowIndex;
        var title = $"{titlePrefix} ({index})";

        var opened = launcher is not null
            ? await launcher.OpenAsync(session, windowId, title)
            : await js.InvokeAsync<bool>("gospelPresenter.openLiveWindow", session, windowId, title);

        if (!opened) return false;

        NextWindowIndex = index + 1;
        windows.Add(new LiveWindowEntry(windowId, index));
        Windows = windows.ToList();
        await SaveAsync();
        Changed?.Invoke();
        return true;
    }

    public async Task CloseWindowAsync(string windowId)
    {
        if (launcher is not null)
            await launcher.CloseAsync(windowId);
        else
            await js.InvokeVoidAsync("gospelPresenter.closeLiveWindow", windowId);

        windows.RemoveAll(w => w.WindowId == windowId);
        Windows = windows.ToList();
        await SaveAsync();
        Changed?.Invoke();
    }

    /// <summary>
    /// Turns the projector output on or off. False when the window could not be opened, so the
    /// caller can say so — the same failure a live window can hit, and just as invisible without it.
    /// </summary>
    public async Task<bool> ToggleExternalDisplayAsync(string title)
    {
        if (HasNativeExternalDisplay)
        {
            if (externalWindowId is { } open)
                await launcher!.CloseAsync(open);
            else if (!await StartNativeExternalDisplayAsync(title))
                return false;
        }
        else if (presentationDisplays.Count > 0)
        {
            foreach (var id in presentationDisplays.ToList())
                await js.InvokeVoidAsync("gospelPresenter.stopPresentation", id);

            presentationDisplays.Clear();
        }
        else
        {
            await StartPresentationDisplayAsync();
        }

        await SaveAsync();
        Changed?.Invoke();
        return true;
    }

    /// <summary>
    /// The projector window is deliberately kept out of <see cref="Windows"/>: it has a row of its
    /// own, and listing it twice would offer two different ways to close one window.
    /// </summary>
    private async Task<bool> StartNativeExternalDisplayAsync(string title)
    {
        if (sessionId is not { } session || launcher is null) return false;

        var windowId = Guid.NewGuid().ToString("N")[..8];
        if (!await launcher.OpenAsync(session, windowId, title)) return false;

        externalWindowId = windowId;
        return true;
    }

    private async Task StartPresentationDisplayAsync()
    {
        if (sessionId is not { } session) return;
        selfRef ??= DotNetObjectReference.Create(this);
        try
        {
            presentationDisplays.Add(
                await js.InvokeAsync<int>("gospelPresenter.startPresentation", session, selfRef));
        }
        catch
        {
            // The operator cancelled the picker, or the API is not really there.
        }
    }

    /// <summary>
    /// Writes down what is on, so the next presentation on this machine comes up the same way.
    /// Public because switching a screen or a public output on is the panel's own doing, and the
    /// bindings it changed belong in the same record as the windows.
    /// </summary>
    public async Task SaveAsync()
    {
        if (sessionId is not { } session) return;

        var enabledDisplayIds = savedDisplays
            .Where(d => remoteDisplayState.IsDisplayConnectedToSession(d.DisplayIdentifier, session))
            .Select(d => d.DisplayIdentifier)
            .ToArray();

        // The same record that is read back, so the two directions cannot drift apart. Blazor's
        // JSON options are the web defaults, which is what turns these into the camelCase keys the
        // script writes to local storage.
        var config = new LiveOutputsConfig(enabledDisplayIds, windows.Count, IsExternalDisplayOn);
        await js.InvokeVoidAsync("gospelPresenter.saveOutputConfig", config);
    }

    private async Task RestoreAsync(string localLiveViewTitle, string externalDisplayTitle)
    {
        if (sessionId is not { } session) return;

        LiveOutputsConfig? config;
        try
        {
            config = await js.InvokeAsync<LiveOutputsConfig?>("gospelPresenter.loadOutputConfig");
        }
        catch
        {
            // Missing or corrupt: nothing to restore, and nothing to report either.
            return;
        }

        if (config is null) return;

        foreach (var displayId in config.EnabledDisplayIds ?? [])
        {
            var display = savedDisplays.FirstOrDefault(d => d.DisplayIdentifier == displayId);
            if (display is null) continue;

            // A public output has no device to be online, so only a screen is required to report
            // itself present before its binding is restored.
            var isAvailable = display.Kind == OutputKind.PublicQr
                              || remoteDisplayState.IsDisplayOnline(displayId);

            // Only if the output is not currently bound to any session — restoring must never
            // steal one from a presentation that is already using it.
            if (isAvailable && !remoteDisplayState.IsDisplayConnected(displayId))
                remoteDisplayState.EnableDisplay(displayId, session, display.Name);
        }

        for (var i = 0; i < (config.WindowCount ?? 0); i++)
            await OpenWindowAsync(localLiveViewTitle);

        if (config.PresentationDisplay != true) return;

        if (HasNativeExternalDisplay && externalWindowId is null)
            await StartNativeExternalDisplayAsync(externalDisplayTitle);
        else if (HasPresentationApi && presentationDisplays.Count == 0)
            await StartPresentationDisplayAsync();
    }

    private void OnNativeWindowClosed(string windowId)
    {
        // Whoever closed it — the operator's toggle, the window's own controls, the presentation
        // stopping — the launcher reports it here and the row goes back to off.
        if (windowId == externalWindowId)
        {
            externalWindowId = null;
        }
        else
        {
            if (windows.RemoveAll(w => w.WindowId == windowId) == 0) return;
            Windows = windows.ToList();
        }

        _ = SaveThenAnnounceAsync();
    }

    /// <summary>Registered by the synchronous JS click path, which opens the window itself.</summary>
    [JSInvokable]
    public void OnLiveWindowOpened(string windowId)
    {
        // Nothing is attached before a presentation is running, and a click that raced the stop
        // must not invent a window for a session that is over.
        if (sessionId is null) return;

        var index = NextWindowIndex++;
        windows.Add(new LiveWindowEntry(windowId, index));
        Windows = windows.ToList();
        _ = SaveThenAnnounceAsync();
    }

    [JSInvokable]
    public void OnLiveWindowClosed(string windowId)
    {
        if (windows.RemoveAll(w => w.WindowId == windowId) == 0) return;
        Windows = windows.ToList();
        _ = SaveThenAnnounceAsync();
    }

    [JSInvokable]
    public void OnPresentationClosed(int id)
    {
        if (!presentationDisplays.Remove(id)) return;
        _ = SaveThenAnnounceAsync();
    }

    /// <summary>
    /// The save has to happen for the callbacks above too, but they are called from JS and cannot
    /// await. Announcing after it keeps the panels showing what was actually written down.
    /// </summary>
    private async Task SaveThenAnnounceAsync()
    {
        try
        {
            await SaveAsync();
        }
        catch
        {
            // A circuit going away mid-save is not worth taking the callback down for.
        }

        Changed?.Invoke();
    }

    public void Dispose()
    {
        sharedAppState.PresentationDeactivated -= OnPresentationDeactivated;
        if (launcher is not null)
            launcher.WindowClosed -= OnNativeWindowClosed;
        selfRef?.Dispose();
    }
}
