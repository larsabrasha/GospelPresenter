using System.IO.Compression;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using GospelPresenter.Web.Auth;
using Microsoft.AspNetCore.Mvc;

namespace GospelPresenter.Web;

public static partial class SyncEndpoints
{
    /// <summary>
    /// The S3 keys a device may write blobs to: its own organisation's media, and nothing else.
    /// The shape mirrors what ImageUrlHelper mints. The organisation segment is compared against
    /// the caller's claims; the character classes just keep keys to the expected flat layout.
    /// </summary>
    [GeneratedRegex(@"^org/(?<org>[A-Za-z0-9-]{1,64})/(?<kind>images|audios|overlays|slides)/[A-Za-z0-9-]{1,64}/[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex MediaKeyPattern();
    public static void MapSyncEndpoints(this WebApplication app)
    {
        // The offline client's pull: everything changed in the caller's organisation since the
        // watermark it presents. Authenticated by device token (or a cookie session — the policy
        // scheme makes no difference here).
        var pull = app.MapPost("/api/sync/pull", async (
            [FromBody] SyncPullRequest request,
            HttpContext context,
            [FromServices] ISyncService syncService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();
            if (caller.OrganizationId is null) return Results.Forbid();

            try
            {
                var response = await syncService.PullAsync(caller.OrganizationId, request, caller, context.RequestAborted);
                return Results.Ok(response);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest("Invalid sync cursor.");
            }
        }).RequireAuthorization();

        // The offline client's push: aggregates and deletes made offline, each answered with an
        // outcome (Applied / ServerWins / CopiedAsNew / Remapped / Failed). Server-side results of
        // conflict policies (the copy, the version snapshot) reach the client on its next pull.
        var push = app.MapPost("/api/sync/push", async (
            [FromBody] SyncPushRequest request,
            HttpContext context,
            [FromServices] ISyncService syncService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();
            if (caller.OrganizationId is null) return Results.Forbid();

            var response = await syncService.PushAsync(caller.OrganizationId, request, caller, context.RequestAborted);
            return Results.Ok(response);
        }).RequireAuthorization();

        // One Bible translation's verses, for offline pinning. The payload is megabytes of highly
        // compressible JSON, so it is gzipped when the client can take it — response compression
        // is deliberately not enabled globally, this endpoint compresses by hand.
        var bibles = app.MapGet("/api/sync/bibles/{id}", async (
            string id,
            HttpContext context,
            [FromServices] ISyncService syncService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();
            if (caller.OrganizationId is null) return Results.Forbid();

            var versesJson = await syncService.GetBibleVersesJsonAsync(caller.OrganizationId, id, caller, context.RequestAborted);
            if (versesJson is null) return Results.NotFound();

            var bytes = Encoding.UTF8.GetBytes(versesJson);
            if (context.Request.Headers.AcceptEncoding.ToString().Contains("gzip", StringComparison.OrdinalIgnoreCase))
            {
                using var compressed = new MemoryStream();
                await using (var gzip = new GZipStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
                    await gzip.WriteAsync(bytes, context.RequestAborted);
                context.Response.Headers.ContentEncoding = "gzip";
                return Results.Bytes(compressed.ToArray(), "application/json");
            }

            return Results.Bytes(bytes, "application/json");
        }).RequireAuthorization();

        // Song displays recorded while presenting offline. Append-only and idempotent: the unique
        // (org, song, date, presentation) index makes a re-push after a lost response a no-op.
        var ccliReports = app.MapPost("/api/sync/ccli-reports", async (
            [FromBody] List<CcliSyncEntry> entries,
            HttpContext context,
            [FromServices] ICcliReportService ccliReportService) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();
            if (caller.OrganizationId is null) return Results.Forbid();
            if (entries.Count > SyncDefaults.MaxPullTake) return Results.BadRequest("Too many entries in one batch.");

            var recorded = await ccliReportService.RecordEntriesAsync(caller.OrganizationId, entries, caller);
            return Results.Ok(new { Recorded = recorded });
        }).RequireAuthorization();

        // Blobs for media created offline: the metadata row travels through /api/sync/push, the
        // bytes land here under the same deterministic key ImageUrlHelper mints. Order-independent —
        // a presentation item pointing at media whose blob has not arrived yet degrades gracefully.
        var media = app.MapPut("/api/sync/media/{**key}", async (
            string key,
            HttpContext context,
            [FromServices] IObjectStorageService storage) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();
            if (caller.OrganizationId is null) return Results.Forbid();

            var match = MediaKeyPattern().Match(key);
            if (!match.Success || match.Groups["org"].Value != caller.OrganizationId)
                return Results.Forbid();

            var (permission, maxSize) = match.Groups["kind"].Value switch
            {
                "images" => (Permission.ManageOrganizationImages, AppConstraints.MaxImageFileSizeBytes),
                "audios" => (Permission.ManageOrganizationAudios, AppConstraints.MaxAudioFileSizeBytes),
                "overlays" => (Permission.ManageOverlays, AppConstraints.MaxImageFileSizeBytes),
                _ => (Permission.ManagePresentations, AppConstraints.MaxSlidesFileSizeBytes),
            };
            if (!caller.HasPermission(permission)) return Results.Forbid();

            if (context.Request.ContentLength is null or 0 || context.Request.ContentLength > maxSize)
                return Results.BadRequest("Missing or oversized body.");

            using var buffer = new MemoryStream();
            await context.Request.Body.CopyToAsync(buffer, context.RequestAborted);
            if (buffer.Length == 0 || buffer.Length > maxSize)
                return Results.BadRequest("Missing or oversized body.");

            var contentType = context.Request.ContentType ?? "application/octet-stream";
            try
            {
                await storage.UploadAsync(key, buffer.ToArray(), contentType, context.RequestAborted);
            }
            catch (NotSupportedException)
            {
                // No object storage configured on this deployment.
                return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            }
            return Results.NoContent();
        }).RequireAuthorization()
          .DisableAntiforgery();

        // The protocol floor applies to every sync surface, not just pull and push: a client too
        // old to be trusted with the aggregate format is equally untrusted with the side channels
        // that feed it. See adr/0002-app-distribution-and-updates.md (25).
        foreach (var endpoint in new[] { pull, push, bibles, ccliReports, media })
            endpoint.AddEndpointFilter<ClientProtocolFloorFilter>();
    }

    private static CallerContext? GetCaller(HttpContext context)
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return null;

        var orgId = context.User.FindFirst("organization_id")?.Value;
        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        return new CallerContext(userId, role, orgId);
    }
}
