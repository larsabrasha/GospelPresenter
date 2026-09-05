using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace GospelPresenter.Shared.State;

public record ActiveSession(string OrganizationId, string? PresentationId, string? PresentationName = null);

public record CcliSongDisplayedEvent(
    string OrganizationId, string SongId, string SongName, string CcliNumber,
    string? PresentationId, string? PresentationName);

public record AudioCommand(string Action, string AudioElementId, double? Position);

/// <summary>
/// Which part of a session changed. Here so that a subscriber can say what it cares about instead
/// of waking for everything: the dashboard's list of live services is unaffected by a slide moving,
/// and a projector has no interest in whether remote control was switched on.
/// </summary>
public enum SessionChangeKind
{
    Slide,
    Overlay,
    Activation,
    RemoteControl,
    Audio
}

/// <summary>
/// One change to one session, addressed well enough to be ignored.
///
/// <paramref name="OrganizationId"/> is null when the session has no presentation running — which
/// also means it appears in no organisation's list of live services. It is resolved at the moment
/// the change happens, because the answer does not survive the change: deactivation and eviction
/// both take the session out of the active set before anyone is told.
/// </summary>
public record SessionChange(string SessionId, string? OrganizationId, SessionChangeKind Kind);

public class SharedAppState
{
    private readonly TimeSpan sessionTimeout;
    private readonly ILogger<SharedAppState> logger;

    public SharedAppState(TimeSpan sessionTimeout) : this(sessionTimeout, NullLogger<SharedAppState>.Instance)
    {
    }

    public SharedAppState(TimeSpan sessionTimeout, ILogger<SharedAppState> logger)
    {
        this.sessionTimeout = sessionTimeout;
        this.logger = logger;
    }

    private readonly ConcurrentDictionary<string, LiveSlide> liveSlides = new();
    private readonly ConcurrentDictionary<string, ActiveOverlay> activeOverlays = new();
    private readonly ConcurrentDictionary<string, ActiveSession> presentationActive = new();
    private readonly ConcurrentDictionary<string, DateTime> lastAccessed = new();
    private readonly ConcurrentDictionary<string, DateTime> expiredSessions = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> ccliTimers = new();
    private readonly ConcurrentDictionary<string, bool> remoteControlEnabled = new();
    private readonly ConcurrentDictionary<string, Audio> sessionAudio = new();
    private readonly ConcurrentDictionary<string, AudioCommand> pendingAudioCommands = new();
    private readonly ConcurrentDictionary<string, bool> ccliReportedElsewhere = new();

    /// <summary>
    /// Raised when something about a session changed, on the thread that changed it.
    ///
    /// This used to be INotifyPropertyChanged with the session id smuggled in as the property name,
    /// which left every subscriber comparing strings and unable to tell what had happened or whom
    /// it concerned. The dashboard consequently filtered on nothing at all and repainted for every
    /// session in every organisation. A subscriber is expected to read <see cref="SessionChange"/>
    /// and ignore what is not addressed to it.
    ///
    /// Raised synchronously, so a handler that renders must dispatch — and restore its own culture
    /// when it does, because this thread's is not necessarily the viewer's. See CircuitCulture.
    /// </summary>
    public event Action<SessionChange>? SessionChanged;

    /// <summary>
    /// Announces a change, resolving the organisation from the session's active presentation. Use
    /// the overload below where the change is what removes it.
    /// </summary>
    private void Announce(string sessionId, SessionChangeKind kind) =>
        Announce(sessionId, kind, presentationActive.GetValueOrDefault(sessionId)?.OrganizationId);

    private void Announce(string sessionId, SessionChangeKind kind, string? organizationId) =>
        SessionChanged?.Invoke(new SessionChange(sessionId, organizationId, kind));

    public static readonly LiveSlide DefaultSlide = new(
        LiveSlideStatus.ShowingPresentation,
        null,
        null,
        null,
        null,
        null,
        null,
        null
    );

    public LiveSlide GetLiveSlide(string sessionId)
    {
        TouchSession(sessionId);
        return liveSlides.GetValueOrDefault(sessionId, DefaultSlide);
    }

    public void SetLiveSlide(string sessionId, LiveSlide slide)
    {
        // Touched before the comparison below: a write that changes nothing is still someone using
        // the session, and letting it age out under an operator who keeps pressing the same slide
        // would be the wrong reading of "stale".
        TouchSession(sessionId);

        // Writing the same slide is not an event, and announcing it as one is what made a click
        // repaint every open page several times over. The surfaces that report their own state —
        // a mirroring desktop client above all — send what they are showing rather than what they
        // changed, so most of what arrives here is already on screen.
        //
        // Returning early also protects the CCLI timer, which is the part that actually breaks:
        // the two calls below cancel and restart the ten-second count, so a session re-reporting
        // the same slide faster than that would never report the song at all.
        if (liveSlides.TryGetValue(sessionId, out var current) && current == slide)
            return;

        CancelCcliTimer(sessionId);
        StartCcliTimerIfNeeded(sessionId, slide);
        liveSlides[sessionId] = slide;
        Announce(sessionId, SessionChangeKind.Slide);
    }

    /// <summary>
    /// Puts the session back to showing nothing, blacked out.
    ///
    /// Where a presentation starts from. A session id outlives the presentations run under it — a
    /// browser tab keeps one for as long as it is open, a device for as long as it is installed —
    /// so the slide the last service ended on is still here when the next one begins. Blacking that
    /// out without clearing it left the previous presentation's slide one press of "show slide"
    /// away from the projector, and nothing on screen said so: the grid marks nothing as live while
    /// the output is black, so the operator had no way to know what was behind it.
    /// </summary>
    public void ClearLiveSlide(string sessionId) =>
        SetLiveSlide(sessionId, DefaultSlide with { Status = LiveSlideStatus.ShowingBlackScreen });

    public ActiveOverlay? GetActiveOverlay(string sessionId)
    {
        return activeOverlays.GetValueOrDefault(sessionId);
    }

    public void SetOverlay(string sessionId, string? text, string? imageUrl, string? overlayId = null)
    {
        TouchSession(sessionId);

        // A new instance every time, so the comparison has to be on the value. ActiveOverlay is a
        // record, which makes that free.
        var overlay = new ActiveOverlay(text, imageUrl, overlayId);
        if (activeOverlays.TryGetValue(sessionId, out var current) && current == overlay)
            return;

        activeOverlays[sessionId] = overlay;
        Announce(sessionId, SessionChangeKind.Overlay);
    }

    public void ClearOverlay(string sessionId)
    {
        TouchSession(sessionId);

        // Clearing an overlay that was not showing is the commonest empty notification of them all:
        // a mirroring client reports "no overlay" on every single slide change.
        if (!activeOverlays.TryRemove(sessionId, out _))
            return;

        Announce(sessionId, SessionChangeKind.Overlay);
    }

    public void ToggleBlackScreen(string sessionId)
    {
        var current = GetLiveSlide(sessionId);
        SetLiveSlide(sessionId, current with
        {
            Status = current.Status == LiveSlideStatus.ShowingBlackScreen
                ? LiveSlideStatus.ShowingPresentation
                : LiveSlideStatus.ShowingBlackScreen
        });
    }

    /// <summary>
    /// Says that something other than this state object already reports what this session displays
    /// to CCLI, and that the timer below must therefore stay out of it.
    ///
    /// A session mirrored from a desktop client is the case: the device counts the song on its own
    /// machine and the count reaches the server through the sync protocol like any other row.
    /// Counting it here as well would report every song of every service twice.
    /// </summary>
    public void SetCcliReportedElsewhere(string sessionId, bool reportedElsewhere)
    {
        if (reportedElsewhere)
            ccliReportedElsewhere[sessionId] = true;
        else
            ccliReportedElsewhere.TryRemove(sessionId, out _);
    }

    public bool IsCcliReportedElsewhere(string sessionId) =>
        ccliReportedElsewhere.ContainsKey(sessionId);

    public bool IsPresentationActive(string sessionId) =>
        presentationActive.ContainsKey(sessionId);

    /// <summary>
    /// Whether anything at all is being presented right now, in any session. The device app has one
    /// user and therefore one session, so "any" is the question it actually wants to ask: it is what
    /// stops an update from restarting the app mid-service. Deliberately broader than "a projector
    /// window is open" — a remote display or the public output is just as live to a congregation,
    /// and on Mac Catalyst the projector window cannot open at all yet.
    /// See adr/0002-app-distribution-and-updates.md (17).
    /// </summary>
    public bool HasActivePresentation => !presentationActive.IsEmpty;

    public string? GetSessionOrganizationId(string sessionId) =>
        presentationActive.GetValueOrDefault(sessionId)?.OrganizationId;

    public void ActivatePresentation(string sessionId, string organizationId, string? presentationId = null, string? presentationName = null)
    {
        TouchSession(sessionId);

        // A mirroring client re-announces its session on every report, so most calls here say what
        // is already true. Nothing downstream needs the repetition: a display that pairs later is
        // told by RemoteDisplayState.DisplayPaired, and Display.OnPresentationActivated is only
        // the catch-up for a display that was already connected when the presentation started.
        var session = new ActiveSession(organizationId, presentationId, presentationName);
        if (presentationActive.TryGetValue(sessionId, out var current) && current == session)
            return;

        presentationActive[sessionId] = session;
        logger.LogDebug(
            "ActivatePresentation sessionId={SessionId} organizationId={OrganizationId} presentationId={PresentationId} activeCount={ActiveCount}",
            sessionId, organizationId, presentationId, presentationActive.Count);
        Announce(sessionId, SessionChangeKind.Activation);
        PresentationActivated?.Invoke(sessionId);
    }

    public void DeactivatePresentation(string sessionId)
    {
        TouchSession(sessionId);
        // The removed session is kept, not discarded: it holds the organisation, and stopping the
        // presentation is precisely what makes that unanswerable afterwards. A dashboard filtering
        // on its own organisation would otherwise miss the one event it most needs.
        var hadActive = presentationActive.TryRemove(sessionId, out var stopped);
        var wasRemoteEnabled = remoteControlEnabled.ContainsKey(sessionId);
        // NOTE: remoteControlEnabled is intentionally preserved here so the
        // user's explicit "remote control" choice survives a Stop→Start cycle
        // within the same session. Disabling is via DisableRemoteControl only.
        var hadAudio = sessionAudio.TryRemove(sessionId, out _);
        var hadPendingCommand = pendingAudioCommands.TryRemove(sessionId, out _);

        // Stopping a presentation that was not running takes nothing down with it. Presentation
        // .Dispose and MirroredSessionProjector.End both call this without knowing whether the
        // session was ever live, so the empty case is the common one.
        if (!hadActive && !hadAudio && !hadPendingCommand)
            return;

        // Said once, and said as what it was. A session that was only holding the audio a stopped
        // presentation had left behind is not a presentation ending: announcing that as an
        // activation told every dashboard a service had stopped, and raising
        // PresentationDeactivated for it told the update button a presentation it had never seen
        // start was over.
        if (!hadActive)
        {
            Announce(sessionId, SessionChangeKind.Audio, null);
            return;
        }

        logger.LogDebug(
            "DeactivatePresentation sessionId={SessionId} hadActivePresentation={HadActive} remoteControlWasEnabled={RemoteControlWasEnabled}",
            sessionId, hadActive, wasRemoteEnabled);
        Announce(sessionId, SessionChangeKind.Activation, stopped?.OrganizationId);
        PresentationDeactivated?.Invoke(sessionId);
    }

    public void EnableRemoteControl(string sessionId)
    {
        TouchSession(sessionId);

        // Reported on every mirrored update, so it is nearly always already on.
        if (remoteControlEnabled.GetValueOrDefault(sessionId))
            return;

        remoteControlEnabled[sessionId] = true;
        var hasActivePresentation = presentationActive.ContainsKey(sessionId);
        logger.LogDebug(
            "EnableRemoteControl sessionId={SessionId} hasActivePresentation={HasActivePresentation}",
            sessionId, hasActivePresentation);
        Announce(sessionId, SessionChangeKind.RemoteControl);
    }

    public void DisableRemoteControl(string sessionId)
    {
        // The other half of the same report: a client with remote control switched off says so
        // every time it tells the server what it is showing.
        if (!remoteControlEnabled.TryRemove(sessionId, out _))
            return;

        logger.LogDebug("DisableRemoteControl sessionId={SessionId}", sessionId);
        Announce(sessionId, SessionChangeKind.RemoteControl);
    }

    public bool IsRemoteControlEnabled(string sessionId) =>
        remoteControlEnabled.GetValueOrDefault(sessionId, false);

    public void SetSessionAudio(string sessionId, Audio? audio)
    {
        if (audio is null)
        {
            if (!sessionAudio.TryRemove(sessionId, out _))
                return;
        }
        else
        {
            // Only catches the identical instance and the case where the parts list is shared.
            // Audio is a record but holds a List<AudioPart>, so record equality compares that list
            // by reference — a freshly built Audio with the same contents is not equal to the old
            // one, and Presentation.razor builds one on every selection change. Making that path
            // quiet needs a comparison of its own, which this is not.
            if (sessionAudio.TryGetValue(sessionId, out var current) && current == audio)
                return;

            sessionAudio[sessionId] = audio;
        }

        Announce(sessionId, SessionChangeKind.Audio);
    }

    public Audio? GetSessionAudio(string sessionId) =>
        sessionAudio.GetValueOrDefault(sessionId);

    /// <summary>
    /// Deliberately not guarded against writing an equal value, unlike everything else here. This
    /// is an inbox, not a value: two identical "play" commands are two requests, and dropping the
    /// second because it looks like the first would lose a press of the button.
    /// </summary>
    public void SetAudioCommand(string sessionId, AudioCommand command)
    {
        pendingAudioCommands[sessionId] = command;
        Announce(sessionId, SessionChangeKind.Audio);
    }

    public AudioCommand? TakeAudioCommand(string sessionId)
    {
        pendingAudioCommands.TryRemove(sessionId, out var cmd);
        return cmd;
    }

    public ActiveSession? GetActiveSession(string sessionId) =>
        presentationActive.GetValueOrDefault(sessionId);

    public event Action<string>? PresentationActivated;
    public event Action<string>? PresentationDeactivated;

    /// <summary>
    /// Every session presenting this presentation right now, oldest key first so the order is
    /// stable between calls.
    ///
    /// There can be more than one: the same service can be running on a desktop in the building and
    /// in a browser somewhere else, and both are legitimate. A controller has to be told which one
    /// it is driving rather than silently getting whichever came back first.
    /// </summary>
    public IReadOnlyList<string> GetActiveSessionIdsForPresentation(string organizationId, string presentationId)
    {
        var resolved = presentationActive
            .Where(kvp => kvp.Value.OrganizationId == organizationId
                       && kvp.Value.PresentationId == presentationId)
            .Select(kvp => kvp.Key)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToList();
        logger.LogDebug(
            "GetActiveSessionIdsForPresentation organizationId={OrganizationId} presentationId={PresentationId} resolvedCount={ResolvedCount}",
            organizationId, presentationId, resolved.Count);
        return resolved;
    }

    /// <summary>
    /// Every presentation running on this server, whoever owns it and whichever organisation it
    /// belongs to. For the one view that is allowed to see across organisations: a live service
    /// nobody can account for is exactly what a superadmin is looking for, so this deliberately
    /// filters nothing. Every other caller wants one of the scoped accessors above.
    /// </summary>
    public IReadOnlyList<(string SessionId, ActiveSession Session)> GetAllActiveSessions() =>
        presentationActive
            .Select(kvp => (kvp.Key, kvp.Value))
            .OrderBy(s => s.Key, StringComparer.Ordinal)
            .ToList();

    public IReadOnlyList<(string SessionId, ActiveSession Session)> GetRemoteEnabledSessionsForOrganization(string organizationId)
    {
        return presentationActive
            .Where(kvp => kvp.Value.OrganizationId == organizationId
                       && IsRemoteControlEnabled(kvp.Key))
            .Select(kvp => (kvp.Key, kvp.Value))
            .ToList();
    }

    public bool IsPresentationActiveForSession(string sessionId, string presentationId) =>
        presentationActive.TryGetValue(sessionId, out var session) && session.PresentationId == presentationId;

    /// <summary>
    /// Announces the change, which it did not do before. It used to get away with silence because
    /// the caller writes a slide immediately afterwards and everyone repainted on that; now that a
    /// dashboard ignores slide changes, the only thing that would tell it this session has moved to
    /// another service is this call. The guard keeps it to once per presentation, not once per click.
    /// </summary>
    public void UpdateActivePresentationId(string sessionId, string presentationId, string? presentationName = null)
    {
        if (!presentationActive.TryGetValue(sessionId, out var session) || session.PresentationId == presentationId)
            return;

        presentationActive[sessionId] = session with { PresentationId = presentationId, PresentationName = presentationName };
        Announce(sessionId, SessionChangeKind.Activation);
    }

    /// <summary>
    /// Raised when a song with a CCLI number has been displayed live for at least 10 seconds.
    /// </summary>
    public event Action<CcliSongDisplayedEvent>? CcliSongDisplayed;

    /// <summary>
    /// Raised when a presentation's theme changes, so an operator switching theme mid-service is reflected
    /// on the projectors, in stage mode and on the public output immediately.
    /// Parameters: presentationId, the resolved theme.
    /// </summary>
    public event Action<string, SlideTheme>? PresentationThemeChanged;

    public void NotifyPresentationThemeChanged(string presentationId, SlideTheme theme) =>
        PresentationThemeChanged?.Invoke(presentationId, theme);

    public bool IsSessionExpired(string sessionId) =>
        expiredSessions.ContainsKey(sessionId);

    public void ClearSessionExpired(string sessionId) =>
        expiredSessions.TryRemove(sessionId, out _);

    /// <summary>
    /// Raised when a presentation's content changes (items added, removed, reordered, etc.).
    /// Parameters: presentationId, senderSessionId (null if from MCP/external source).
    /// </summary>
    public event Action<string, string?>? PresentationChanged;

    public void NotifyPresentationChanged(string presentationId, string? senderSessionId = null)
    {
        PresentationChanged?.Invoke(presentationId, senderSessionId);
    }

    private void CancelCcliTimer(string sessionId)
    {
        if (ccliTimers.TryRemove(sessionId, out var cts))
        {
            cts.Cancel();
            cts.Dispose();
        }
    }

    private void StartCcliTimerIfNeeded(string sessionId, LiveSlide slide)
    {
        if (slide.Status != LiveSlideStatus.ShowingPresentation
            || slide.ItemType != ProjectItemType.Song
            || string.IsNullOrEmpty(slide.CcliNumber)
            || string.IsNullOrEmpty(slide.SongId))
            return;

        if (ccliReportedElsewhere.ContainsKey(sessionId))
            return;

        var session = presentationActive.GetValueOrDefault(sessionId);
        if (session is null) return;

        var evt = new CcliSongDisplayedEvent(
            session.OrganizationId,
            slide.SongId,
            slide.SongName ?? "",
            slide.CcliNumber,
            session.PresentationId,
            session.PresentationName);

        var cts = new CancellationTokenSource();
        ccliTimers[sessionId] = cts;

        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(10), cts.Token);
                CcliSongDisplayed?.Invoke(evt);
            }
            catch (OperationCanceledException)
            {
                // Timer was cancelled — slide changed before 10 seconds
            }
            catch (ObjectDisposedException)
            {
                // CTS was disposed during cleanup
            }
        }, cts.Token);
    }

    private void TouchSession(string sessionId)
    {
        var now = DateTime.UtcNow;
        lastAccessed[sessionId] = now;
        CleanupStaleSessions(now);
    }

    /// <summary>
    /// Runs the eviction sweep without anything having been touched.
    ///
    /// The sweep below is otherwise reached only from <see cref="TouchSession"/> — that is, only
    /// when somebody is using some session. A server that has gone quiet therefore never runs it,
    /// and a session left behind by a browser that was closed outlives the timeout it is supposed
    /// to have until the next time anyone starts anything. The web host calls this on a timer.
    /// </summary>
    public void SweepStaleSessions() => CleanupStaleSessions(DateTime.UtcNow);

    private void CleanupStaleSessions(DateTime now)
    {
        foreach (var (sessionId, accessed) in lastAccessed)
        {
            if (now - accessed <= sessionTimeout) continue;

            var wasRemoteEnabled = remoteControlEnabled.ContainsKey(sessionId);

            CancelCcliTimer(sessionId);
            liveSlides.TryRemove(sessionId, out _);
            activeOverlays.TryRemove(sessionId, out _);
            // Kept for the same reason as in DeactivatePresentation: the organisation is gone from
            // the active set the moment the session is evicted, and the announcement below needs it.
            var wasActive = presentationActive.TryRemove(sessionId, out var evicted);
            remoteControlEnabled.TryRemove(sessionId, out _);
            sessionAudio.TryRemove(sessionId, out _);
            pendingAudioCommands.TryRemove(sessionId, out _);
            ccliReportedElsewhere.TryRemove(sessionId, out _);
            lastAccessed.TryRemove(sessionId, out _);

            if (wasActive || wasRemoteEnabled)
            {
                logger.LogDebug(
                    "CleanupStaleSessions evicted sessionId={SessionId} ageSeconds={AgeSeconds} wasActive={WasActive} wasRemoteEnabled={WasRemoteEnabled}",
                    sessionId, (int)(now - accessed).TotalSeconds, wasActive, wasRemoteEnabled);
            }

            if (wasActive)
            {
                expiredSessions[sessionId] = now;
                Announce(sessionId, SessionChangeKind.Activation, evicted?.OrganizationId);
                // Said the same way an operator's own Stop says it. Eviction used to announce the
                // change and stop there, which left a remote controller still pointed at the
                // session it had picked: nothing re-ran its choice, so it went on describing a
                // machine this server had already forgotten.
                PresentationDeactivated?.Invoke(sessionId);
            }
        }

        foreach (var (sessionId, expiredAt) in expiredSessions)
        {
            if (now - expiredAt > sessionTimeout)
            {
                expiredSessions.TryRemove(sessionId, out _);
            }
        }
    }
}
