using System.Collections.Concurrent;
using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace GospelPresenter.Shared.State;

public record ActiveSession(string OrganizationId, string? PresentationId, string? PresentationName = null);

public record CcliSongDisplayedEvent(
    string OrganizationId, string SongId, string SongName, string CcliNumber,
    string? PresentationId, string? PresentationName);

public record AudioCommand(string Action, string AudioElementId, double? Position);

public partial class SharedAppState : ObservableObject
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
        TouchSession(sessionId);
        CancelCcliTimer(sessionId);
        StartCcliTimerIfNeeded(sessionId, slide);
        liveSlides[sessionId] = slide;
        OnPropertyChanged(sessionId);
    }

    public ActiveOverlay? GetActiveOverlay(string sessionId)
    {
        return activeOverlays.GetValueOrDefault(sessionId);
    }

    public void SetOverlay(string sessionId, string? text, string? imageUrl)
    {
        TouchSession(sessionId);
        activeOverlays[sessionId] = new ActiveOverlay(text, imageUrl);
        OnPropertyChanged(sessionId);
    }

    public void ClearOverlay(string sessionId)
    {
        TouchSession(sessionId);
        activeOverlays.TryRemove(sessionId, out _);
        OnPropertyChanged(sessionId);
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
        presentationActive[sessionId] = new ActiveSession(organizationId, presentationId, presentationName);
        logger.LogDebug(
            "ActivatePresentation sessionId={SessionId} organizationId={OrganizationId} presentationId={PresentationId} activeCount={ActiveCount}",
            sessionId, organizationId, presentationId, presentationActive.Count);
        OnPropertyChanged(sessionId);
        PresentationActivated?.Invoke(sessionId);
    }

    public void DeactivatePresentation(string sessionId)
    {
        TouchSession(sessionId);
        var hadActive = presentationActive.TryRemove(sessionId, out _);
        var wasRemoteEnabled = remoteControlEnabled.ContainsKey(sessionId);
        // NOTE: remoteControlEnabled is intentionally preserved here so the
        // user's explicit "remote control" choice survives a Stop→Start cycle
        // within the same session. Disabling is via DisableRemoteControl only.
        sessionAudio.TryRemove(sessionId, out _);
        pendingAudioCommands.TryRemove(sessionId, out _);
        logger.LogDebug(
            "DeactivatePresentation sessionId={SessionId} hadActivePresentation={HadActive} remoteControlWasEnabled={RemoteControlWasEnabled}",
            sessionId, hadActive, wasRemoteEnabled);
        OnPropertyChanged(sessionId);
        PresentationDeactivated?.Invoke(sessionId);
    }

    public void EnableRemoteControl(string sessionId)
    {
        TouchSession(sessionId);
        remoteControlEnabled[sessionId] = true;
        var hasActivePresentation = presentationActive.ContainsKey(sessionId);
        logger.LogDebug(
            "EnableRemoteControl sessionId={SessionId} hasActivePresentation={HasActivePresentation}",
            sessionId, hasActivePresentation);
        OnPropertyChanged(sessionId);
    }

    public void DisableRemoteControl(string sessionId)
    {
        var removed = remoteControlEnabled.TryRemove(sessionId, out _);
        logger.LogDebug(
            "DisableRemoteControl sessionId={SessionId} hadEntry={HadEntry}",
            sessionId, removed);
        OnPropertyChanged(sessionId);
    }

    public bool IsRemoteControlEnabled(string sessionId) =>
        remoteControlEnabled.GetValueOrDefault(sessionId, false);

    public void SetSessionAudio(string sessionId, Audio? audio)
    {
        if (audio is null)
            sessionAudio.TryRemove(sessionId, out _);
        else
            sessionAudio[sessionId] = audio;
        OnPropertyChanged(sessionId);
    }

    public Audio? GetSessionAudio(string sessionId) =>
        sessionAudio.GetValueOrDefault(sessionId);

    public void SetAudioCommand(string sessionId, AudioCommand command)
    {
        pendingAudioCommands[sessionId] = command;
        OnPropertyChanged(sessionId);
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

    public string? GetActiveSessionIdForPresentation(string organizationId, string presentationId)
    {
        var resolved = presentationActive
            .Where(kvp => kvp.Value.OrganizationId == organizationId
                       && kvp.Value.PresentationId == presentationId)
            .Select(kvp => kvp.Key)
            .FirstOrDefault();
        logger.LogDebug(
            "GetActiveSessionIdForPresentation organizationId={OrganizationId} presentationId={PresentationId} resolvedSessionId={ResolvedSessionId}",
            organizationId, presentationId, resolved);
        return resolved;
    }

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

    public void UpdateActivePresentationId(string sessionId, string presentationId, string? presentationName = null)
    {
        if (presentationActive.TryGetValue(sessionId, out var session) && session.PresentationId != presentationId)
            presentationActive[sessionId] = session with { PresentationId = presentationId, PresentationName = presentationName };
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

    private void CleanupStaleSessions(DateTime now)
    {
        foreach (var (sessionId, accessed) in lastAccessed)
        {
            if (now - accessed <= sessionTimeout) continue;

            var wasActive = presentationActive.ContainsKey(sessionId);
            var wasRemoteEnabled = remoteControlEnabled.ContainsKey(sessionId);

            CancelCcliTimer(sessionId);
            liveSlides.TryRemove(sessionId, out _);
            activeOverlays.TryRemove(sessionId, out _);
            presentationActive.TryRemove(sessionId, out _);
            remoteControlEnabled.TryRemove(sessionId, out _);
            sessionAudio.TryRemove(sessionId, out _);
            pendingAudioCommands.TryRemove(sessionId, out _);
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
                OnPropertyChanged(sessionId);
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
