using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using GospelPresenter.Shared.Components.Presentations;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Mvc;

namespace GospelPresenter.Web;

/// <summary>
/// Anonymous endpoints for public outputs — the pages and streams a visitor reaches by scanning
/// an output's QR code.
///
/// These are deliberately plain minimal-API endpoints rather than Razor routes: App.razor mounts
/// the router with an interactive render mode, so a routed page would give every visitor a Blazor
/// circuit. See PublicWatchPage.razor for the reasoning.
/// </summary>
public static class PublicOutputEndpoints
{
    private static readonly TimeSpan PingInterval = TimeSpan.FromSeconds(15);

    public static void MapPublicOutputEndpoints(this WebApplication app)
    {
        MapWatchPage(app);
        MapEventStream(app);
        MapImageProxy(app);
    }

    private static void MapWatchPage(WebApplication app)
    {
        app.MapGet("/watch/{code}", async (
            string code,
            HttpContext httpContext,
            [FromServices] IRemoteDisplayService remoteDisplayService,
            [FromServices] ILoggerFactory loggerFactory) =>
        {
            var output = await remoteDisplayService.FindPublicOutputAsync(code);
            if (output is null)
                return Results.NotFound();

            var parameters = ParameterView.FromDictionary(new Dictionary<string, object?>
            {
                [nameof(PublicWatchPage.Code)] = output.DisplayIdentifier,
                [nameof(PublicWatchPage.OrganizationName)] = output.Organization?.Name,
                [nameof(PublicWatchPage.OutputName)] = output.Name
            });

            // Rendered per request so the waiting screen follows the visitor's Accept-Language.
            await using var renderer = new HtmlRenderer(httpContext.RequestServices, loggerFactory);
            var html = await renderer.Dispatcher.InvokeAsync(async () =>
                (await renderer.RenderComponentAsync<PublicWatchPage>(parameters)).ToHtmlString());

            return Results.Content(html, "text/html; charset=utf-8");
        }).AllowAnonymous();
    }

    private static void MapEventStream(WebApplication app)
    {
        app.MapGet("/api/watch/{code}/stream", async (
            string code,
            [FromQuery(Name = "v")] string? v,
            HttpContext httpContext,
            [FromServices] IRemoteDisplayService remoteDisplayService,
            [FromServices] PublicOutputState publicOutputState,
            [FromServices] PublicOutputBroadcaster broadcaster,
            CancellationToken cancellationToken) =>
        {
            var output = await remoteDisplayService.FindPublicOutputAsync(code);
            if (output is null)
                return Results.NotFound();

            if (string.IsNullOrWhiteSpace(v))
                return Results.BadRequest();

            var viewerId = v;
            var response = httpContext.Response;
            response.Headers.ContentType = "text/event-stream";
            response.Headers.CacheControl = "no-cache, no-store";
            // Tell any reverse proxy not to buffer the stream, or slides arrive in batches.
            response.Headers["X-Accel-Buffering"] = "no";

            if (!publicOutputState.TryAddViewer(output.DisplayIdentifier, viewerId, out var reader))
            {
                await WriteEventAsync(response, "full", null, cancellationToken);
                return Results.Empty;
            }

            try
            {
                var current = await broadcaster.GetCurrentEventAsync(output.DisplayIdentifier);
                await WriteOutputEventAsync(response, current, cancellationToken);

                while (!cancellationToken.IsCancellationRequested)
                {
                    // Either the next state change or a keep-alive, whichever comes first. The
                    // ping is what detects a phone that went away without closing the socket.
                    using var pingCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                    pingCts.CancelAfter(PingInterval);

                    try
                    {
                        var evt = await reader.ReadAsync(pingCts.Token);
                        await WriteOutputEventAsync(response, evt, cancellationToken);
                    }
                    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                    {
                        await response.WriteAsync(":ping\n\n", cancellationToken);
                        await response.Body.FlushAsync(cancellationToken);
                        publicOutputState.TouchViewer(output.DisplayIdentifier, viewerId);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // The visitor navigated away, locked the screen, or lost the network.
            }
            catch (ChannelClosedException)
            {
                // The output was removed or its code regenerated while this viewer was connected.
            }
            finally
            {
                publicOutputState.RemoveViewer(output.DisplayIdentifier, viewerId);
            }

            return Results.Empty;
        }).AllowAnonymous();
    }

    private static void MapImageProxy(WebApplication app)
    {
        // Imported presentation pages.
        app.MapGet("/api/watch/{code}/image/slides/{slidesId}/{page:int}", async (
            string code, string slidesId, int page,
            HttpContext context,
            [FromServices] PublicOutputBroadcaster broadcaster,
            [FromServices] IObjectStorageService storage) =>
        {
            var orgId = broadcaster.GetBroadcastingOrganizationId(code);
            if (orgId is null) return Results.NotFound();

            return await ServeAsync(context, storage, ImageUrlHelper.SlidesPageKey(orgId, slidesId, page));
        }).AllowAnonymous();

        // Organisation images and overlay images.
        app.MapGet("/api/watch/{code}/image/{type}/{id}/{variant}", async (
            string code, string type, string id, string variant,
            HttpContext context,
            [FromServices] PublicOutputBroadcaster broadcaster,
            [FromServices] IObjectStorageService storage) =>
        {
            var orgId = broadcaster.GetBroadcastingOrganizationId(code);
            if (orgId is null) return Results.NotFound();

            var s3Key = type switch
            {
                "org-image" => ImageUrlHelper.OrgImageKey(orgId, id, variant),
                "overlay" => ImageUrlHelper.OverlayImageKey(orgId, id),
                _ => null
            };

            if (s3Key is null) return Results.NotFound();

            return await ServeAsync(context, storage, s3Key);
        }).AllowAnonymous();
    }

    private static async Task<IResult> ServeAsync(
        HttpContext context, IObjectStorageService storage, string s3Key)
    {
        var result = await storage.GetAsync(s3Key);
        if (result is null) return Results.NotFound();

        var (stream, contentType) = result.Value;
        context.Response.Headers.CacheControl = "public, max-age=3600";
        return Results.File(stream, contentType);
    }

    private static Task WriteOutputEventAsync(
        HttpResponse response, PublicOutputEvent evt, CancellationToken cancellationToken)
    {
        return evt.Type switch
        {
            PublicOutputEventType.Slide => WriteEventAsync(response, "slide", evt.Html, cancellationToken),
            _ => WriteEventAsync(response, "idle", null, cancellationToken)
        };
    }

    private static async Task WriteEventAsync(
        HttpResponse response, string eventName, string? payload, CancellationToken cancellationToken)
    {
        // The payload is JSON-encoded so that an HTML fragment containing newlines still fits on
        // a single SSE data line.
        var data = JsonSerializer.Serialize(payload ?? "");

        var builder = new StringBuilder()
            .Append("event: ").Append(eventName).Append('\n')
            .Append("data: ").Append(data).Append("\n\n");

        await response.WriteAsync(builder.ToString(), cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }
}
