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

    /// <summary>
    /// The last state the owning device reported, or null for a session that is not mirrored or has
    /// not reported anything yet.
    ///
    /// A controller needs this because its own screen is not evidence. It writes what it wants into
    /// the live state immediately — that is what makes it feel instant, and it is the write the
    /// forwarder picks up and sends down — so the state it can see already says yes regardless of
    /// what the projector did. Only the owner's echo says the device followed.
    /// </summary>
    MirroredSessionState? LastReported(string sessionId);

    /// <summary>
    /// What the owning device is called — the name its user gave it when registering it, which is
    /// also the name shown in the device list. Null for a session that is not mirrored, or whose
    /// token predates the name.
    /// </summary>
    string? OwnerName(string sessionId);

    /// <summary>Raised with the session id when an owner connects or drops.</summary>
    event Action<string>? OwnerPresenceChanged;
}
