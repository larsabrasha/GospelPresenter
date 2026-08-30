using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;

namespace GospelPresenter.Web.Live;

/// <summary>
/// Writes what a device says it is showing into this server's live state, so that everything
/// already built on <see cref="SharedAppState"/> — the public outputs, a phone in remote mode, the
/// dashboard's list of live services — works for a desktop presentation without knowing that it is
/// one.
///
/// The device sends a selection, never a rendered slide. The slide is rebuilt here from the
/// server's own copy of the presentation, which is the only way the image URLs can point somewhere
/// a visitor's phone can actually reach.
/// </summary>
public class MirroredSessionProjector(
    SharedAppState sharedAppState,
    MirroredSessionRegistry registry,
    IPresentationService presentations,
    IThemeService themes,
    ILiveSlideBuilder slideBuilder,
    ILogger<MirroredSessionProjector> logger)
{
    public async Task ApplyAsync(string sessionId, string organizationId, MirroredSessionState state, CallerContext caller)
    {
        // Recorded before anything is written, so that every write below is already recognisable as
        // the owner's own and is not forwarded back down to it as a command. The suppression covers
        // the half-written states in between, which match neither the old selection nor the new.
        registry.RecordReportedState(sessionId, state);
        using var _ = registry.SuppressForwarding(sessionId);

        // The device counts its own CCLI usage locally and syncs it up like any other row.
        sharedAppState.SetCcliReportedElsewhere(sessionId, true);

        var presentation = await presentations.GetPresentationByIdAsync(state.PresentationId, organizationId, caller);
        if (presentation is null)
        {
            // The presentation has not reached this server yet, or was deleted here. Registering the
            // session anyway would leave a phone controlling something the server cannot render.
            logger.LogWarning(
                "Mirrored session {SessionId} reported presentation {PresentationId}, which this server does not have",
                sessionId, state.PresentationId);
            return;
        }

        sharedAppState.ActivatePresentation(sessionId, organizationId, presentation.Id, presentation.Name);

        if (state.RemoteControlEnabled)
            sharedAppState.EnableRemoteControl(sessionId);
        else
            sharedAppState.DisableRemoteControl(sessionId);

        await ApplyOverlayAsync(sessionId, organizationId, state.OverlayId, caller);
        await ApplySlideAsync(sessionId, organizationId, presentation, state, caller);
    }

    private async Task ApplySlideAsync(
        string sessionId,
        string organizationId,
        Presentation presentation,
        MirroredSessionState state,
        CallerContext caller)
    {
        var current = sharedAppState.GetLiveSlide(sessionId);

        if (state.BlackScreen)
        {
            // The selection is kept: coming back off a black screen must land on the same slide.
            sharedAppState.SetLiveSlide(sessionId, current with { Status = LiveSlideStatus.ShowingBlackScreen });
            return;
        }

        if (state.ItemId is null || state.PartIndex is null)
        {
            sharedAppState.SetLiveSlide(sessionId, SharedAppState.DefaultSlide);
            return;
        }

        var theme = await themes.GetForPresentationAsync(organizationId, presentation.ThemeId, caller);

        var request = LiveSlideRequest.ForItem(
            sessionId, organizationId, presentation, state.ItemId, state.PartIndex.Value, theme, caller);
        if (request is null)
        {
            logger.LogWarning(
                "Mirrored session {SessionId} selected item {ItemId}, which presentation {PresentationId} does not have here",
                sessionId, state.ItemId, presentation.Id);
            return;
        }

        var slide = slideBuilder.Build(current, request);
        // Null means an audio item, which has no slide of its own — leave what is showing alone,
        // exactly as the operator's own machine does.
        if (slide is not null)
            sharedAppState.SetLiveSlide(sessionId, slide);
    }

    private async Task ApplyOverlayAsync(
        string sessionId, string organizationId, string? overlayId, CallerContext caller)
    {
        if (overlayId is null)
        {
            sharedAppState.ClearOverlay(sessionId);
            return;
        }

        var overlays = await presentations.GetOverlaysAsync(organizationId, caller);
        var overlay = overlays.FirstOrDefault(o => o.Id == overlayId);
        if (overlay is null)
        {
            sharedAppState.ClearOverlay(sessionId);
            return;
        }

        sharedAppState.SetOverlay(
            sessionId,
            overlay.Content,
            overlay.HasImage ? ImageUrlHelper.LiveOverlayImageUrl(sessionId, overlay.Id) : null,
            overlay.Id);
    }

    /// <summary>
    /// The owner has stopped presenting. Everything the session held goes with it, including the
    /// CCLI exemption — the next session under this id may well be an ordinary browser one.
    /// </summary>
    public void End(string sessionId)
    {
        using var _ = registry.SuppressForwarding(sessionId);
        sharedAppState.DeactivatePresentation(sessionId);
        sharedAppState.SetCcliReportedElsewhere(sessionId, false);
        registry.Remove(sessionId);
    }
}
