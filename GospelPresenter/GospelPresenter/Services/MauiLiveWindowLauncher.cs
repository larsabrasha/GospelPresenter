using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Services;

/// <summary>
/// The device's projector windows: each live view is a real second MAUI window on /live. When an
/// external screen is connected the new window is parked there in fullscreen automatically (the
/// window needs a moment to materialise natively, hence the retries); the "show on screen 2" menu
/// item re-runs the move for stubborn setups. Whoever closes a window — the user with ⌘W, the
/// presentation stopping, the operator's panel — everything observes the same Destroying event.
/// </summary>
public class MauiLiveWindowLauncher(
    IExternalDisplayService externalDisplay,
    ILogger<MauiLiveWindowLauncher> logger) : ILiveWindowLauncher
{
    private readonly Dictionary<string, Window> windows = new();
    private string? latestWindowTitle;

    public event Action<string>? WindowClosed;

    public Task<bool> OpenAsync(string sessionId, string windowId, string title) =>
        MainThread.InvokeOnMainThreadAsync(() =>
        {
            if (Application.Current is not { } application)
                return false;

            var window = new Window(new LivePage(sessionId, windowId, title)) { Title = title };
            window.Destroying += (_, _) =>
            {
                windows.Remove(windowId);
                WindowClosed?.Invoke(windowId);
            };

            application.OpenWindow(window);
            windows[windowId] = window;
            latestWindowTitle = title;

            if (externalDisplay.HasExternalScreen)
                _ = MoveToExternalWithRetriesAsync(title);
            return true;
        });

    public Task CloseAsync(string windowId) =>
        MainThread.InvokeOnMainThreadAsync(() =>
        {
            if (windows.TryGetValue(windowId, out var window))
                Application.Current?.CloseWindow(window);
        });

    /// <summary>The menu fallback: sends the most recently opened live window to the external screen.</summary>
    public Task<bool> MoveLatestToExternalAsync() =>
        MainThread.InvokeOnMainThreadAsync(() =>
            latestWindowTitle is not null && windows.Count > 0
            && externalDisplay.TryMoveWindowToExternalScreen(latestWindowTitle));

    private async Task MoveToExternalWithRetriesAsync(string title)
    {
        // The native window appears asynchronously after OpenWindow; poll briefly for it.
        foreach (var delay in new[] { 300, 600, 1200 })
        {
            await Task.Delay(delay);
            var moved = await MainThread.InvokeOnMainThreadAsync(() =>
            {
                try
                {
                    return externalDisplay.TryMoveWindowToExternalScreen(title);
                }
                catch (Exception e)
                {
                    logger.LogWarning(e, "Moving the live window to the external screen failed");
                    return false;
                }
            });
            if (moved)
                return;
        }

        logger.LogInformation("The live window stayed on the main screen; the menu item can move it manually");
    }
}
