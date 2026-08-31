using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Live;

/// <summary>
/// Writes what a controller asked for into this device's own live state — the mirror image of the
/// server's <c>MirroredSessionProjector</c>, and deliberately built the same way.
///
/// Both ends rebuild a slide from a selection rather than shipping a rendered one, and both do it
/// through <see cref="ILiveSlideBuilder"/>, so the projector in the room and the congregation's
/// screens cannot end up disagreeing about what a selection means. The difference is only which
/// database the presentation is read from and which machine's media the URLs point at.
///
/// A singleton with no UI attached: the device is drivable for exactly as long as it is presenting,
/// whatever page the operator has open and however many windows are up.
/// </summary>
public class LocalSessionProjector(
    SharedAppState sharedAppState,
    ILiveSlideBuilder slideBuilder,
    IThemeService themes,
    DeviceAuthService auth,
    IServiceScopeFactory scopeFactory,
    ILogger<LocalSessionProjector> logger) : ILiveSessionCommandApplier
{
    public async Task ApplyAsync(string sessionId, MirroredSessionCommand command)
    {
        var session = sharedAppState.GetActiveSession(sessionId);
        if (session?.PresentationId is null)
        {
            // Nothing is being presented here any more. The controller will be told as much the
            // next time the owner reports, and a command for a session that is over is not an error.
            logger.LogDebug("Ignoring a command for {SessionId}, which is not presenting", sessionId);
            return;
        }

        if (auth.CurrentIdentity is not { } identity)
        {
            logger.LogWarning("A command arrived before this device knew who it was signed in as");
            return;
        }

        var caller = new CallerContext(identity.UserId, identity.Role, session.OrganizationId);

        // Scoped, because the presentation service is: one scope per command rather than one held
        // open for the life of the app.
        using var scope = scopeFactory.CreateScope();
        var presentations = scope.ServiceProvider.GetRequiredService<IPresentationService>();

        var presentation = await presentations.GetPresentationByIdAsync(
            session.PresentationId, session.OrganizationId, caller);
        if (presentation is null)
        {
            logger.LogWarning(
                "A command named presentation {PresentationId}, which this device does not have",
                session.PresentationId);
            return;
        }

        await ApplyOverlayAsync(sessionId, session.OrganizationId, command.OverlayId, presentations, caller);
        await ApplySlideAsync(sessionId, session.OrganizationId, presentation, command, caller);
    }

    private async Task ApplySlideAsync(
        string sessionId,
        string organizationId,
        Presentation presentation,
        MirroredSessionCommand command,
        CallerContext caller)
    {
        var current = sharedAppState.GetLiveSlide(sessionId);

        if (command.ItemId is not null && command.PartIndex is not null)
        {
            var theme = await themes.GetForPresentationAsync(organizationId, presentation.ThemeId, caller);

            var request = LiveSlideRequest.ForItem(
                sessionId, organizationId, presentation, command.ItemId, command.PartIndex.Value, theme, caller);
            if (request is null)
            {
                logger.LogWarning(
                    "A command selected item {ItemId}, which presentation {PresentationId} does not have here",
                    command.ItemId, presentation.Id);
                return;
            }

            // Null means an audio item, which has no slide of its own — leave what is showing alone,
            // exactly as an operator's own click does.
            var built = slideBuilder.Build(current, request);
            if (built is not null)
                current = built;
        }

        // Applied last and absolutely, so that coming off a black screen lands back on the slide the
        // selection names rather than on whatever was up before it went black.
        var next = current with
        {
            Status = command.BlackScreen
                ? LiveSlideStatus.ShowingBlackScreen
                : LiveSlideStatus.ShowingPresentation
        };

        // A command that asks for what is already showing is left alone rather than written again.
        // Writing restarts the ten-second CCLI timer, and absolute commands legitimately repeat —
        // a resend after reconnecting, a duplicate tap — so a song held on screen through a couple
        // of those would otherwise have its clock pushed back each time and never be counted.
        if (next == sharedAppState.GetLiveSlide(sessionId)) return;

        sharedAppState.SetLiveSlide(sessionId, next);
    }

    private async Task ApplyOverlayAsync(
        string sessionId,
        string organizationId,
        string? overlayId,
        IPresentationService presentations,
        CallerContext caller)
    {
        // Both branches check before writing: every write notifies, and a command that changes
        // nothing should not wake every surface on the session or restart any clock.
        var current = sharedAppState.GetActiveOverlay(sessionId)?.Id;
        if (current == overlayId) return;

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
}
