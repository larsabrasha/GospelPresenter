using System.Collections.Concurrent;
using ElectronNET.API;
using ElectronNET.API.Entities;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Opens the live (projector) view as a second Electron window, on the projector when there is one.
///
/// This is the capability the whole move off Mac Catalyst was for: UIKit reports a single screen on
/// macOS however many are attached, so the app could not see a projector, let alone put a window on
/// it. Electron reports every display with its position in the desktop's coordinate space, and a
/// window placed at those coordinates lands there.
/// </summary>
public class ElectronLiveWindowLauncher(IServer server, ILogger<ElectronLiveWindowLauncher> logger)
    : ILiveWindowLauncher
{
    /// <summary>
    /// Prefixed onto the projector window's title so a window manager can tell it apart from the
    /// operator window. Both carry the same class — one application, one class — and the rest of the
    /// title is the output's name, which the user chooses and changes.
    ///
    /// It exists for Wayland. Measured on Hyprland running the app natively on Wayland (hyprctl
    /// reports xwayland: 0): the operator window asked for 1280x860 and was given 701x418, and the
    /// projector window opened on the operator's screen rather than the one its coordinates named.
    /// The compositor, not the client, is placing windows.
    ///
    /// The coordinates below are still right where they are honoured — macOS and Windows are
    /// verified. What remedy that leaves on Wayland is still open: a rule in the user's compositor
    /// is one, forcing the app onto XWayland so its own geometry is honoured may be another, and
    /// which is right is being measured on a real machine. Either way a rule needs something stable
    /// to match on, and today there is nothing: both windows carry the same class, and the rest of
    /// this title is the output's name, which the user chooses and changes.
    ///
    /// Deliberately not localized. It is a handle for a window manager, not text for a person: the
    /// window is frameless, so nobody ever reads it, and a title that changed with the app's
    /// language would silently break the rule the user wrote.
    /// </summary>
    private const string ProjectorTitlePrefix = "Gospel Presenter Projector";

    private readonly ConcurrentDictionary<string, BrowserWindow> windows = new();

    public event Action<string>? WindowClosed;

    public async Task<bool> OpenAsync(string sessionId, string windowId, string title)
    {
        try
        {
            var target = await ChooseDisplayAsync();
            var windowTitle = $"{ProjectorTitlePrefix} — {title}";
            var options = target is null ? Windowed(windowTitle) : FillingDisplay(windowTitle, target);

            var url = $"{BaseAddress()}/live?session={Uri.EscapeDataString(sessionId)}" +
                      $"&windowId={Uri.EscapeDataString(windowId)}" +
                      $"&title={Uri.EscapeDataString(title)}";

            var window = await Electron.WindowManager.CreateWindowAsync(options, url);
            window.OnClosed += () =>
            {
                windows.TryRemove(windowId, out _);
                WindowClosed?.Invoke(windowId);
            };
            window.OnReadyToShow += () =>
            {
                window.Show();
                // Kiosk is applied once the window exists on the target display, not asked for in
                // the constructor: given both at once, Electron can take over the primary display
                // instead of the one the coordinates name. It covers the menu bar, which a plain
                // window cannot — a projector must not show a strip of the operator's desktop.
                if (target is not null)
                    window.SetKiosk(true);
            };

            windows[windowId] = window;
            logger.LogInformation("Live window {WindowId} opened on {Where}",
                windowId, target is null ? "the primary display, windowed" : $"display {target.Id}");
            return true;
        }
        catch (Exception e)
        {
            // The caller tells the user the window did not open; it must not fault their click.
            logger.LogError(e, "Opening the live window failed");
            return false;
        }
    }

    public async Task<bool> HasExternalDisplayAsync() => await ChooseDisplayAsync() is not null;

    public Task CloseAsync(string windowId)
    {
        // Close, not Destroy: OnClosed still fires, so the panel hears about it the same way it
        // would if the user had closed the window themselves.
        if (windows.TryGetValue(windowId, out var window))
            window.Close();

        return Task.CompletedTask;
    }

    /// <summary>
    /// The display to present on: the first one that is not the primary. Electron marks the
    /// built-in panel <see cref="Display.Internal"/>, but that is no help on a desktop machine
    /// where every display is external — which is primary is the question that actually separates
    /// "the one the operator is looking at" from "the one the audience is looking at".
    /// </summary>
    private static async Task<Display?> ChooseDisplayAsync()
    {
        var displays = await Electron.Screen.GetAllDisplaysAsync();
        if (displays.Length < 2)
            return null;

        var primary = await Electron.Screen.GetPrimaryDisplayAsync();
        return Array.Find(displays, d => d.Id != primary.Id);
    }

    /// <summary>
    /// Lands the window on the projector, ready to be made fullscreen once it is there.
    ///
    /// The geometry comes from the display's work area rather than its bounds: a normal window
    /// cannot cover the menu bar, so asking for the full bounds gets the window nudged down below it
    /// and left hanging off the bottom edge. Fullscreen, applied afterwards, is what actually takes
    /// the whole display.
    /// </summary>
    private static BrowserWindowOptions FillingDisplay(string title, Display display) => new()
    {
        Title = title,
        X = display.WorkArea.X,
        Y = display.WorkArea.Y,
        Width = display.WorkArea.Width,
        Height = display.WorkArea.Height,
        Frame = false,
        BackgroundColor = "#000000",
        Show = false,
        AutoHideMenuBar = true,
    };

    /// <summary>
    /// One display only: a plain window the operator can move and resize, which is what the web app
    /// gives them too. Presenting on the same screen you are operating on is a rehearsal, not a
    /// service, and taking the whole screen over would be wrong.
    /// </summary>
    private static BrowserWindowOptions Windowed(string title) => new()
    {
        Title = title,
        Width = 1280,
        Height = 720,
        BackgroundColor = "#000000",
        Show = false,
        AutoHideMenuBar = true,
    };

    /// <summary>
    /// Where Kestrel ended up listening. The port is not ours to choose — Electron.NET starts the
    /// host on a free one — so it is read back from the server rather than configured.
    /// </summary>
    private string BaseAddress()
    {
        var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses;
        return addresses?.FirstOrDefault()?.TrimEnd('/')
               ?? throw new InvalidOperationException("The server is not listening on any address yet.");
    }
}
