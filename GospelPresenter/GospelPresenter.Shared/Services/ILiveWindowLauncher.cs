namespace GospelPresenter.Shared.Services;

/// <summary>
/// Opens and closes local live (projector) windows natively. The desktop and MAUI hosts register an
/// implementation — a second app window of their own on /live; the web keeps its synchronous
/// window.open() path, which must run inside the click gesture or Safari blocks it, so components
/// resolve this optionally and fall back to the JS route without it.
/// </summary>
public interface ILiveWindowLauncher
{
    /// <summary>Opens a live window for the session. False when the window could not be created.</summary>
    Task<bool> OpenAsync(string sessionId, string windowId, string title);

    Task CloseAsync(string windowId);

    /// <summary>
    /// Whether there is a display to present on that the operator is not working on. Where this is
    /// true, <see cref="OpenAsync"/> puts the window there and fills it; where it is false, a live
    /// window is just a second window on the one screen.
    ///
    /// The web asks the browser's Presentation API the same question instead. That API exists in a
    /// desktop webview too, but has nothing to offer there — it looks for Cast receivers, not the
    /// monitor on the desk — so a host that answers true here is saying "ignore it and ask me".
    /// </summary>
    Task<bool> HasExternalDisplayAsync();

    /// <summary>Raised with the window id when a live window closed, whoever closed it.</summary>
    event Action<string>? WindowClosed;
}
