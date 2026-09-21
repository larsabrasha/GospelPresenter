using ElectronNET.API;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Keeps a window on the app. The bridge exposes no cancellable navigation hook (there is no
/// will-navigate or setWindowOpenHandler in ElectronNET.Core 0.5.2), so this is the compensating
/// control: a navigation to any origin but our own localhost is logged, the window is pulled back
/// to the app, and the URL is handed to the system browser so a genuinely clicked link still opens
/// somewhere. With Node out of the renderer the residual risk of a foreign page is what a browser
/// tab carries; this is defence in depth, not the fence.
/// </summary>
public static class RendererNavigationGuard
{
    public static void Attach(BrowserWindow window, Uri allowedOrigin, ILogger logger)
    {
        window.WebContents.OnDidStartNavigation += url =>
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var target))
                return;
            if (target.Scheme is not ("http" or "https"))
                return;
            if (SameOrigin(target, allowedOrigin))
                return;

            logger.LogWarning("Blocked a navigation of the app window to {Url}; opening it externally instead", url);
            window.LoadURL(allowedOrigin.ToString());
            _ = Electron.Shell.OpenExternalAsync(url);
        };
    }

    /// <summary>
    /// Where Kestrel ended up listening. The port is not ours to choose — Electron.NET starts the
    /// host on a free one — so it is read back from the server rather than configured.
    /// </summary>
    public static Uri KestrelOrigin(IServer server)
    {
        var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault()
                      ?? throw new InvalidOperationException("The server is not listening on any address yet.");
        return new Uri(address);
    }

    private static bool SameOrigin(Uri a, Uri b) =>
        string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase)
        && a.Port == b.Port;
}
