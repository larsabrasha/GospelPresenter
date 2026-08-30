using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Live;

/// <summary>
/// Reads a live session out of <see cref="SharedAppState"/> in the mirrored form.
///
/// Both ends use this one function, and the loop protection depends on it. The server decides
/// whether a change came from the owning device by comparing what it now sees against what the
/// owner last reported; if the two sides described the same state even slightly differently, every
/// change would look foreign and be forwarded straight back to the device that made it.
/// </summary>
public static class MirroredSessionStateReader
{
    /// <summary>Null when the session is not presenting anything.</summary>
    public static MirroredSessionState? Read(SharedAppState state, string sessionId)
    {
        var active = state.GetActiveSession(sessionId);
        if (active?.PresentationId is null) return null;

        var slide = state.GetLiveSlide(sessionId);

        return new MirroredSessionState(
            active.PresentationId,
            active.PresentationName,
            state.IsRemoteControlEnabled(sessionId),
            slide.Status == LiveSlideStatus.ShowingBlackScreen,
            slide.ProjectItemId,
            slide.ItemPartIndex,
            state.GetActiveOverlay(sessionId)?.Id);
    }

    /// <summary>
    /// Whether two states show the same thing. Only what a controller can ask for is compared —
    /// the presentation's name and whether remote control is switched on are the owner's business
    /// and must never be echoed back down as instructions.
    /// </summary>
    public static bool ShowsTheSame(MirroredSessionState a, MirroredSessionState b) =>
        a.PresentationId == b.PresentationId
        && a.ItemId == b.ItemId
        && a.PartIndex == b.PartIndex
        && a.BlackScreen == b.BlackScreen
        && a.OverlayId == b.OverlayId;

    public static MirroredSessionCommand ToCommand(this MirroredSessionState state) =>
        new(state.ItemId, state.PartIndex, state.BlackScreen, state.OverlayId);
}
