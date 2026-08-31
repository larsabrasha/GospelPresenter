using ElectronNET.API.Entities;

namespace GospelPresenter.Desktop.Services;

public static class BrowserWindowOptionsExtensions
{
    /// <summary>
    /// Hides the menu bar until Alt is pressed, where there is one to hide. macOS keeps the menu in
    /// the system bar rather than in the window, so the option does not exist there — setting it
    /// anyway is what CA1416 objects to, and the guard is what teaches the analyser the difference.
    /// </summary>
    public static BrowserWindowOptions WithHiddenMenuBar(this BrowserWindowOptions options)
    {
        if (OperatingSystem.IsLinux() || OperatingSystem.IsWindows())
            options.AutoHideMenuBar = true;

        return options;
    }
}
