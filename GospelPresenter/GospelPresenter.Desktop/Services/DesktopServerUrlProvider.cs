using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Points every link this app hands to another device at the server rather than at itself.
///
/// The desktop app serves its UI from localhost on a port Electron picks at each launch, so a QR
/// code built from that address is unopenable on the phone that scans it and stale by the next
/// start. The server it mirrors to is reachable from the room; that is the address to print.
///
/// Empty when no server is configured, which is the standalone development build — the base class's
/// null then keeps the old local behaviour, since there is no server to point at.
/// </summary>
public class DesktopServerUrlProvider(string apiBaseUrl) : IServerUrlProvider
{
    public string? GetServerUrl() => apiBaseUrl.Length > 0 ? apiBaseUrl : null;
}
