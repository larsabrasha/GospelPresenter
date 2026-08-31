using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Services;

/// <summary>
/// Opens a live (projector) view as a second app window. Whoever closes one — the user, the
/// presentation stopping, the operator's panel — everything observes the same Destroying event.
///
/// Placing that window on a projector is not attempted here. It never worked on Mac Catalyst, which
/// is gone, and no mobile platform lets an app choose a display; a Mac or PC driving a projector
/// runs the desktop app, which owns real windows and can put one wherever it likes.
/// </summary>
public class MauiLiveWindowLauncher(ILogger<MauiLiveWindowLauncher> logger) : ILiveWindowLauncher
{
    private readonly Dictionary<string, Window> windows = new();

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

            try
            {
                // Multi-window support varies by platform, and where it is missing this throws.
                // Report it as a failure so the caller can tell the user, rather than faulting
                // the click.
                application.OpenWindow(window);
            }
            catch (Exception e)
            {
                logger.LogError(e, "Opening the live window failed");
                return false;
            }

            windows[windowId] = window;
            return true;
        });

    /// <summary>
    /// Never. No mobile platform lets an app choose which display it draws on, and a Mac or PC
    /// driving a projector runs the desktop app, which owns real windows and can place one.
    /// </summary>
    public Task<bool> HasExternalDisplayAsync() => Task.FromResult(false);

    public Task CloseAsync(string windowId) =>
        MainThread.InvokeOnMainThreadAsync(() =>
        {
            if (windows.TryGetValue(windowId, out var window))
                Application.Current?.CloseWindow(window);
        });
}
