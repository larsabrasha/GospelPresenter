using System.Security.Cryptography;
using System.Text;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// A host that knows its own session identity, rather than letting the browser invent one.
///
/// The web has no use for this: a session is a tab, and <c>getOrCreateSessionId</c> in session
/// storage is exactly the right lifetime for it. A desktop installation is the opposite — it is one
/// machine standing in one room, and the session id ends up in the live image URLs and in whatever
/// a mobile is pointed at to control it. Losing it on restart would break both, in the middle of a
/// service, which is when a crash is least welcome and a restart most likely.
/// </summary>
public interface ISessionIdProvider
{
    /// <summary>
    /// The host's own session id, or null to let the browser supply one. Null is the honest answer
    /// before the device has an identity — a fresh installation that has never signed in.
    /// </summary>
    string? GetSessionId();
}

public static class DeviceSessionId
{
    /// <summary>
    /// The session id a device presents under. Derived rather than stored so that the client and
    /// the server arrive at the same string without either having to tell the other — the server
    /// derives it from the authenticated device token and never trusts a client's own claim about
    /// which session it is.
    ///
    /// Hashed rather than used raw because the id travels in <c>/api/live-images/{sessionId}/…</c>,
    /// which is served anonymously: it must not hand out the device token's primary key. Twelve hex
    /// characters, against the browser's eight, for a value that lives for years rather than a tab.
    /// </summary>
    public static string For(string deviceTokenId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"session:{deviceTokenId}"));
        return Convert.ToHexStringLower(hash)[..12];
    }
}
