using System.Collections.Concurrent;
using CommunityToolkit.Mvvm.ComponentModel;

namespace GospelPresenter.Shared.State;

public partial class SharedAppState : ObservableObject
{
    private readonly TimeSpan sessionTimeout;

    public SharedAppState(TimeSpan sessionTimeout)
    {
        this.sessionTimeout = sessionTimeout;
    }

    private readonly ConcurrentDictionary<string, LiveSlide> liveSlides = new();
    private readonly ConcurrentDictionary<string, ActiveOverlay> activeOverlays = new();
    private readonly ConcurrentDictionary<string, string> presentationActive = new();
    private readonly ConcurrentDictionary<string, DateTime> lastAccessed = new();
    private readonly ConcurrentDictionary<string, DateTime> expiredSessions = new();

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
        presentationActive.GetValueOrDefault(sessionId);

    public void SetPresentationActive(string sessionId, bool active, string organizationId)
    {
        TouchSession(sessionId);
        if (active)
            presentationActive[sessionId] = organizationId;
        else
            presentationActive.TryRemove(sessionId, out _);
        OnPropertyChanged(sessionId);
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

            liveSlides.TryRemove(sessionId, out _);
            activeOverlays.TryRemove(sessionId, out _);
            presentationActive.TryRemove(sessionId, out _);
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
