namespace GospelPresenter.Services;

/// <summary>
/// Platform access to physically connected screens (the projector). Only Mac Catalyst has an
/// implementation in v1; everywhere else the live window simply opens on the main screen.
/// </summary>
public interface IExternalDisplayService
{
    bool HasExternalScreen { get; }

    /// <summary>
    /// Moves the native window with the given title to the external screen and makes it
    /// fullscreen. False when there is no external screen or the window was not found (yet).
    /// </summary>
    bool TryMoveWindowToExternalScreen(string windowTitle);
}

public class NullExternalDisplayService : IExternalDisplayService
{
    public bool HasExternalScreen => false;
    public bool TryMoveWindowToExternalScreen(string windowTitle) => false;
}
