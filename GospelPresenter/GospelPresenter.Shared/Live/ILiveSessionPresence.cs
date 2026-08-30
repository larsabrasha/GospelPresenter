namespace GospelPresenter.Shared.Live;

/// <summary>
/// Whether the machine behind a live session can still be reached.
///
/// Only mirrored sessions can answer anything but "yes": a presentation running in a browser on
/// this same server is as reachable as the page asking about it. A mirrored one is a device
/// somewhere else, and it can drop off the network in the middle of a service — at which point what
/// it last showed stays on the congregation's screens, but nobody can move it on.
///
/// Registered by the web host only. Everywhere else there is nothing to be out of touch with.
/// </summary>
public interface ILiveSessionPresence
{
    /// <summary>Whether this session is owned by a device rather than by a browser on this server.</summary>
    bool IsMirrored(string sessionId);

    /// <summary>
    /// Whether the owning device is reachable. Always true for a session that is not mirrored,
    /// so callers can ask without first checking which kind they have.
    /// </summary>
    bool IsOwnerOnline(string sessionId);

    /// <summary>Raised with the session id when an owner connects or drops.</summary>
    event Action<string>? OwnerPresenceChanged;
}
