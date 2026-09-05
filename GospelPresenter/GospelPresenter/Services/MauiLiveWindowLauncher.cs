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
    private readonly Dictionary<string, (LiveWindowEntry Entry, Window Window)> windows = new();

    public event Action<string>? WindowClosed;

    public Task<bool> OpenAsync(LiveWindowEntry entry) =>
        MainThread.InvokeOnMainThreadAsync(() =>
        {
            if (Application.Current is not { } application)
                return false;

            var windowId = entry.WindowId;
            var window = new Window(new LivePage(entry)) { Title = entry.Title };
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

            windows[windowId] = (entry, window);
            return true;
        });

    /// <summary>
    /// Never. No mobile platform lets an app choose which display it draws on, and a Mac or PC
    /// driving a projector runs the desktop app, which owns real windows and can place one.
    /// </summary>
    public Task<bool> HasExternalDisplayAsync() => Task.FromResult(false);

    /// <summary>
    /// This launcher is a singleton and the operator's circuit is not, so this is what an operator
    /// page coming back from a reload reads instead of opening a second set of windows.
    /// </summary>
    public IReadOnlyList<LiveWindowEntry> OpenWindowsFor(string sessionId) => windows.Values
        .Select(w => w.Entry)
        .Where(e => e.SessionId == sessionId)
        .OrderBy(e => e.Index)
        .ToList();

    public Task CloseAsync(string windowId) =>
        MainThread.InvokeOnMainThreadAsync(() =>
        {
            if (windows.TryGetValue(windowId, out var tracked))
                Application.Current?.CloseWindow(tracked.Window);
        });
}
