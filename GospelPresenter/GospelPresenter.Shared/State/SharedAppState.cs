using System.Collections.Concurrent;
using CommunityToolkit.Mvvm.ComponentModel;

namespace GospelPresenter.Shared.State;

public record ActiveSession(string OrganizationId, string? PresentationId, string? PresentationName = null);

public record CcliSongDisplayedEvent(
    string OrganizationId, string SongId, string SongName, string CcliNumber,
    string? PresentationId, string? PresentationName);

public record AudioCommand(string Action, string AudioElementId, double? Position);

public partial class SharedAppState : ObservableObject
{
    private readonly TimeSpan sessionTimeout;

    public SharedAppState(TimeSpan sessionTimeout)
    {
        this.sessionTimeout = sessionTimeout;
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

    public string? GetSessionOrganizationId(string sessionId) =>
        presentationActive.GetValueOrDefault(sessionId)?.OrganizationId;

    public void ActivatePresentation(string sessionId, string organizationId, string? presentationId = null, string? presentationName = null)
    {
        TouchSession(sessionId);
        presentationActive[sessionId] = new ActiveSession(organizationId, presentationId, presentationName);
        OnPropertyChanged(sessionId);
        PresentationActivated?.Invoke(sessionId);
    }

    public void DeactivatePresentation(string sessionId)
    {
        TouchSession(sessionId);
        presentationActive.TryRemove(sessionId, out _);
        remoteControlEnabled.TryRemove(sessionId, out _);
        sessionAudio.TryRemove(sessionId, out _);
        pendingAudioCommands.TryRemove(sessionId, out _);
        OnPropertyChanged(sessionId);
        PresentationDeactivated?.Invoke(sessionId);
    }

    public void EnableRemoteControl(string sessionId)
    {
        remoteControlEnabled[sessionId] = true;
        OnPropertyChanged(sessionId);
    }

    public void DisableRemoteControl(string sessionId)
    {
        remoteControlEnabled.TryRemove(sessionId, out _);
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

    public string? GetActiveSessionIdForOrganization(string organizationId)
    {
        return presentationActive
            .Where(kvp => kvp.Value.OrganizationId == organizationId)
            .Select(kvp => kvp.Key)
            .FirstOrDefault();
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

    public event Action<string, SlideTextStyle, SlideTextStyle, SlideTextStyle, SlideTextStyle>? OrganizationSlideStylesChanged;

    public void NotifyOrganizationSlideStylesChanged(
        string organizationId,
        SlideTextStyle songStyle,
        SlideTextStyle creditsStyle,
        SlideTextStyle bibleStyle,
        SlideTextStyle bibleCreditsStyle)
    {
        OrganizationSlideStylesChanged?.Invoke(organizationId, songStyle, creditsStyle, bibleStyle, bibleCreditsStyle);
    }

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

            CancelCcliTimer(sessionId);
            liveSlides.TryRemove(sessionId, out _);
            activeOverlays.TryRemove(sessionId, out _);
            presentationActive.TryRemove(sessionId, out _);
            remoteControlEnabled.TryRemove(sessionId, out _);
            sessionAudio.TryRemove(sessionId, out _);
            pendingAudioCommands.TryRemove(sessionId, out _);
            lastAccessed.TryRemove(sessionId, out _);

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
