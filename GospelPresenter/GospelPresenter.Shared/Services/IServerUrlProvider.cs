using Microsoft.AspNetCore.Components;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Where the server this host talks to can be reached from somebody else's device.
///
/// A link or QR code is only worth anything if the phone that scans it can open it, and the address
/// the app is being served on is not always that address. On the web the two are the same and this
/// answers null. On a device host they are not: the desktop app serves its own UI from
/// <c>http://127.0.0.1:{a port it picks at launch}</c>, so a QR built from that lands a visitor on
/// their own phone's loopback, and the port is gone at the next restart anyway.
/// </summary>
public interface IServerUrlProvider
{
    /// <summary>
    /// The server's public base address, or null to use the address this host is served on. Null is
    /// the right answer for the web, and for a device running standalone with no server at all —
    /// there is then no better address to point anyone at.
    /// </summary>
    string? GetServerUrl();
}

/// <summary>The web host, and any device with no server configured: the current address is the address.</summary>
public class LocalServerUrlProvider : IServerUrlProvider
{
    public string? GetServerUrl() => null;
}

public static class ServerUrls
{
    /// <summary>
    /// An absolute URL for something another device will open, built against the server rather than
    /// against whatever this host happens to be served on.
    /// </summary>
    /// <param name="relativePath">Rooted or not, without a leading slash requirement.</param>
    public static string Absolute(
        IServerUrlProvider provider, NavigationManager navigation, string relativePath)
    {
        var root = provider.GetServerUrl() is { Length: > 0 } url
            ? url.TrimEnd('/')
            : navigation.BaseUri.TrimEnd('/');

        return $"{root}/{relativePath.TrimStart('/')}";
    }
}
