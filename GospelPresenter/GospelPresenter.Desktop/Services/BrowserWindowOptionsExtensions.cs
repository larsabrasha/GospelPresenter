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

    /// <summary>
    /// A renderer with no Node in it. The page is ordinary Blazor Server served by Kestrel and asks
    /// Electron for nothing — every Electron call the app makes runs in the main process, through
    /// the .NET bridge — so the renderer gets the privileges a browser tab has and no more. Without
    /// this, ElectronNET.Core fills in <c>nodeIntegration: true, contextIsolation: false</c> for a
    /// window that names no preferences, which turns any markup injected into the app into code
    /// running on the operator's machine.
    ///
    /// Every bool in <see cref="WebPreferences"/> is serialised as soon as the object exists (the
    /// bridge only leaves out nulls), so the security-relevant ones are all named here rather than
    /// left to the C# constructor defaults — in particular <c>Sandbox</c>, whose C# default is
    /// false although Electron's own is true.
    /// </summary>
    public static BrowserWindowOptions WithLockedDownRenderer(this BrowserWindowOptions options)
    {
        options.WebPreferences = new WebPreferences
        {
            NodeIntegration = false,
            NodeIntegrationInWorker = false,
            NodeIntegrationInSubFrames = false,
            ContextIsolation = true,
            Sandbox = true,
            WebSecurity = true,
            AllowRunningInsecureContent = false,
            WebviewTag = false,
            EnableRemoteModule = false,
        };

        return options;
    }
}
