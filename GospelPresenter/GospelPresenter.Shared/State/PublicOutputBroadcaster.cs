using System.ComponentModel;
using GospelPresenter.Shared.Components.Presentations;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.State;

/// <summary>
/// Turns live presentation state into HTML for the public outputs that have viewers.
///
/// The slide is rendered once per output per change and the same string is pushed to every
/// viewer, so the cost of a bigger audience is one open response per person rather than a
/// render and a diff per person.
/// </summary>
public class PublicOutputBroadcaster : IDisposable
{
    private readonly IServiceProvider services;
    private readonly ILoggerFactory loggerFactory;
    private readonly SharedAppState sharedAppState;
    private readonly RemoteDisplayState remoteDisplayState;
    private readonly PublicOutputState publicOutputState;
    private readonly ILogger<PublicOutputBroadcaster> logger;

    public PublicOutputBroadcaster(
        IServiceProvider services,
        ILoggerFactory loggerFactory,
        SharedAppState sharedAppState,
        RemoteDisplayState remoteDisplayState,
        PublicOutputState publicOutputState)
    {
        this.services = services;
        this.loggerFactory = loggerFactory;
        this.sharedAppState = sharedAppState;
        this.remoteDisplayState = remoteDisplayState;
        this.publicOutputState = publicOutputState;
        logger = loggerFactory.CreateLogger<PublicOutputBroadcaster>();

        // SharedAppState raises PropertyChanged with the session id as the property name, and
        // does so for slide changes, black screen, overlays, activation and deactivation alike.
        sharedAppState.PropertyChanged += OnSharedAppStateChanged;
        remoteDisplayState.DisplayPaired += OnOutputBindingChanged;
        remoteDisplayState.DisplayUnpaired += OnOutputBindingChanged;
    }

    /// <summary>
    /// The session currently broadcasting to an output, or null if nothing is.
    ///
    /// Both conditions matter: an output that has been switched off has no bound session, and a
    /// bound session that is not presenting has nothing to send. This is the single gate for
    /// everything a visitor may see — the slide fragments and the proxied images alike.
    /// </summary>
    public string? GetBroadcastingSessionId(string outputCode)
    {
        var sessionId = remoteDisplayState.GetSessionForDisplay(outputCode);
        if (sessionId is null || !sharedAppState.IsPresentationActive(sessionId))
            return null;

        return sessionId;
    }

    /// <summary>
    /// The organisation whose images an output may serve, or null if it may serve none.
    /// Organisation isolation itself falls out of the S3 key structure, exactly as it does for
    /// the live-image endpoints.
    /// </summary>
    public string? GetBroadcastingOrganizationId(string outputCode)
    {
        var sessionId = GetBroadcastingSessionId(outputCode);
        return sessionId is null ? null : sharedAppState.GetSessionOrganizationId(sessionId);
    }

    /// <summary>
    /// Builds the event describing what an output should be showing right now. Used both when a
    /// viewer connects and whenever the live state changes.
    /// </summary>
    public async Task<PublicOutputEvent> GetCurrentEventAsync(string outputCode)
    {
        var sessionId = GetBroadcastingSessionId(outputCode);
        if (sessionId is null)
            return PublicOutputEvent.Idle;

        var slide = sharedAppState.GetLiveSlide(sessionId);
        if (slide.Status == LiveSlideStatus.ShowingBlackScreen)
            return PublicOutputEvent.Idle;

        if (slide.ItemType is null)
            return PublicOutputEvent.Idle;

        var overlay = sharedAppState.GetActiveOverlay(sessionId);

        try
        {
            var html = await RenderSlideAsync(slide, overlay, sessionId, outputCode);
            return PublicOutputEvent.Slide(html);
        }
        catch (Exception ex)
        {
            // A failed render must not take the visitors' pages down — fall back to the
            // waiting screen, which is a legible state rather than a blank one.
            logger.LogError(ex, "Failed to render slide for public output {OutputCode}", outputCode);
            return PublicOutputEvent.Idle;
        }
    }

    private async Task<string> RenderSlideAsync(
        LiveSlide slide, ActiveOverlay? overlay, string sessionId, string outputCode)
    {
        // The visitors must never receive the operator's session id, so image URLs are rewritten
        // to go through the output's own proxy before the fragment is rendered.
        var proxiedSlide = slide with
        {
            ImageUrl = ImageUrlHelper.ToWatchUrl(slide.ImageUrl, sessionId, outputCode)
        };

        var proxiedOverlay = overlay is null
            ? null
            : overlay with
            {
                ImageUrl = ImageUrlHelper.ToWatchUrl(overlay.ImageUrl, sessionId, outputCode)
            };

        var parameters = ParameterView.FromDictionary(new Dictionary<string, object?>
        {
            [nameof(PublicSlideView.LiveSlide)] = proxiedSlide,
            [nameof(PublicSlideView.Overlay)] = proxiedOverlay
        });

        // A scope of its own: the render components take everything as parameters, but every
        // component in this assembly inherits an IStringLocalizer injection from _Imports.razor.
        //
        // That scope is not a circuit, so nothing pins its language and CircuitCulture falls back to
        // the ambient culture of whichever thread got here — the caller's, or none at all. It does
        // not show today because PublicSlideView has no localized text: it renders the operator's
        // slide, whose words come from the presentation. The first L[...] added under here will need
        // a language decided on purpose, and the honest source is the organisation, not the thread.
        await using var scope = services.CreateAsyncScope();
        await using var renderer = new HtmlRenderer(scope.ServiceProvider, loggerFactory);

        return await renderer.Dispatcher.InvokeAsync(async () =>
        {
            var output = await renderer.RenderComponentAsync<PublicSlideView>(parameters);
            return output.ToHtmlString();
        });
    }

    private void OnSharedAppStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        var sessionId = e.PropertyName;
        if (string.IsNullOrEmpty(sessionId))
            return;

        // Only outputs that actually have viewers are worth rendering for. That set is small,
        // so the reverse lookup from session to output needs no bookkeeping of its own — and it
        // keeps the knowledge of which displays are public out of the state layer.
        foreach (var outputCode in publicOutputState.GetCodesWithViewers())
        {
            if (remoteDisplayState.GetSessionForDisplay(outputCode) == sessionId)
                RefreshOutput(outputCode);
        }
    }

    private void OnOutputBindingChanged(string displayId)
    {
        if (publicOutputState.GetViewerCount(displayId) > 0)
            RefreshOutput(displayId);
    }

    /// <summary>
    /// Renders and publishes the current state of an output. Fire-and-forget on purpose: the
    /// callers are synchronous state-change notifications that must not wait for a render.
    /// </summary>
    public void RefreshOutput(string outputCode)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var evt = await GetCurrentEventAsync(outputCode);
                publicOutputState.Publish(outputCode, evt);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to publish state for public output {OutputCode}", outputCode);
            }
        });
    }

    public void Dispose()
    {
        sharedAppState.PropertyChanged -= OnSharedAppStateChanged;
        remoteDisplayState.DisplayPaired -= OnOutputBindingChanged;
        remoteDisplayState.DisplayUnpaired -= OnOutputBindingChanged;
    }
}
