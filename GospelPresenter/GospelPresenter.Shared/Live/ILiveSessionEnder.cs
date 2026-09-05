namespace GospelPresenter.Shared.Live;

/// <summary>
/// Ends a mirrored live session from the server side, without asking the device that owns it.
///
/// Deliberately narrow, and deliberately separate from <see cref="ILiveSessionPresence"/>: the
/// protocol carries no "stop" for a device that is listening, and adr/0004 is explicit that only
/// the owner ends its own session. What this is for is the case the adr does not cover — an owner
/// that is not listening at all.
///
/// A device whose app was killed, whose laptop was shut, or that left the building mid-service
/// leaves its session running here: what it last showed stays up, which is right for a few seconds
/// of bad wifi and wrong for the rest of the evening. Nothing else could end it, so the session sat
/// on the dashboard and on the congregation's screens until it aged out hours later.
///
/// Registered by the web host only, and only the web has mirrored sessions to end.
/// </summary>
public interface ILiveSessionEnder
{
    /// <summary>
    /// Ends the session and releases the outputs it held. Callers must first establish that the
    /// owner is offline — <see cref="ILiveSessionPresence.IsOwnerOnline"/> — because an owner that
    /// is still reporting simply activates it again, and the gap in between is a page telling the
    /// operator their service has stopped when it has not.
    /// </summary>
    void End(string sessionId);
}
