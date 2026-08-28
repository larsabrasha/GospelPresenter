namespace GospelPresenter.Shared.Services;

/// <summary>
/// Opens and closes local live (projector) windows natively. Only the MAUI host registers an
/// implementation — a second app window with its own webview on /live; the web keeps its
/// synchronous window.open() path, which must run inside the click gesture or Safari blocks it,
/// so components resolve this optionally and fall back to the JS route without it.
/// </summary>
public interface ILiveWindowLauncher
{
    /// <summary>Opens a live window for the session. False when the window could not be created.</summary>
    Task<bool> OpenAsync(string sessionId, string windowId, string title);

    Task CloseAsync(string windowId);

    /// <summary>Raised with the window id when a live window closed, whoever closed it.</summary>
    event Action<string>? WindowClosed;
}
