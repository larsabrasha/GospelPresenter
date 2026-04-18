using System.Security.Claims;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web;

public static class UploadEndpoints
{

    public static void MapUploadEndpoints(this WebApplication app)
    {
        app.MapPost("/api/upload/org-image", async (
            HttpContext context,
            IOrganizationImageService imageService,
            IImageResizeService imageResizeService,
            CancellationToken cancellationToken) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var (file, orgId) = await ReadUploadAsync(context, cancellationToken);
            if (file is null) return Results.BadRequest();
            if (orgId is null) return Results.BadRequest("Missing organizationId");

            if (file.Length > AppConstraints.MaxImageFileSizeBytes) return Results.BadRequest("File too large");
            if (!AppConstraints.AllowedImageTypes.Contains(file.ContentType)) return Results.BadRequest("Unsupported file type");
            if (file.FileName.Length > AppConstraints.FileNameMaxLength) return Results.BadRequest("File name too long");

            byte[] fullData, thumbData;
            string contentType;
            try
            {
                using var stream = file.OpenReadStream();
                (fullData, thumbData, contentType) = imageResizeService.Resize(stream, file.ContentType);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest("Invalid image file");
            }

            try
            {
                var image = await imageService.AddImageAsync(orgId, file.FileName, contentType, thumbData, fullData, caller, cancellationToken);
                return Results.Ok(new { image.Id, image.FileName, image.ContentType, image.CreatedAt });
            }
            catch (NotSupportedException)
            {
                return Results.StatusCode(503);
            }
        }).RequireAuthorization()
          .DisableAntiforgery();

        app.MapPost("/api/upload/overlay-image/{overlayId}", async (
            string overlayId,
            HttpContext context,
            IPresentationService presentationService,
            IObjectStorageService storage,
            CancellationToken cancellationToken) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var (file, orgId) = await ReadUploadAsync(context, cancellationToken);
            if (file is null) return Results.BadRequest();
            if (orgId is null) return Results.BadRequest("Missing organizationId");

            if (file.Length > AppConstraints.MaxImageFileSizeBytes) return Results.BadRequest("File too large");
            if (!AppConstraints.AllowedImageTypes.Contains(file.ContentType)) return Results.BadRequest("Unsupported file type");
            if (file.FileName.Length > AppConstraints.FileNameMaxLength) return Results.BadRequest("File name too long");

            var overlay = await presentationService.GetOverlayByIdAsync(overlayId, orgId, caller, cancellationToken);
            if (overlay is null) return Results.NotFound();

            using var ms = new MemoryStream();
            await file.CopyToAsync(ms, cancellationToken);

            try
            {
                var key = ImageUrlHelper.OverlayImageKey(orgId, overlayId);
                await storage.UploadAsync(key, ms.ToArray(), file.ContentType, cancellationToken);
            }
            catch (NotSupportedException)
            {
                return Results.StatusCode(503);
            }

            overlay.HasImage = true;
            overlay.ImageData = null;
            overlay.ImageContentType = null;
            await presentationService.UpdateOverlayAsync(orgId, overlay, caller, cancellationToken);

            return Results.Ok(new { overlayId, hasImage = true });
        }).RequireAuthorization()
          .DisableAntiforgery();

        app.MapPost("/api/upload/org-audio", async (
            HttpContext context,
            IOrganizationAudioService audioService,
            CancellationToken cancellationToken) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var (file, orgId) = await ReadUploadAsync(context, cancellationToken);
            if (file is null) return Results.BadRequest();
            if (orgId is null) return Results.BadRequest("Missing organizationId");

            if (file.Length > AppConstraints.MaxAudioFileSizeBytes) return Results.BadRequest("File too large");
            if (!AppConstraints.AllowedAudioTypes.Contains(file.ContentType)) return Results.BadRequest("Unsupported file type");
            if (file.FileName.Length > AppConstraints.FileNameMaxLength) return Results.BadRequest("File name too long");

            using var ms = new MemoryStream();
            await file.CopyToAsync(ms, cancellationToken);

            try
            {
                var audio = await audioService.AddAudioAsync(orgId, file.FileName, file.ContentType, ms.ToArray(), caller, cancellationToken);
                return Results.Ok(new { audio.Id, audio.FileName, audio.ContentType, audio.CreatedAt });
            }
            catch (NotSupportedException)
            {
                return Results.StatusCode(503);
            }
        }).RequireAuthorization()
          .DisableAntiforgery();

        app.MapPost("/api/upload/presentation-slides/{presentationId}", async (
            string presentationId,
            HttpContext context,
            IPdfRenderService pdfRenderService,
            IPresentationSlidesService slidesService,
            CancellationToken cancellationToken) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var (file, orgId) = await ReadUploadAsync(context, cancellationToken);
            if (file is null) return Results.BadRequest();
            if (orgId is null) return Results.BadRequest("Missing organizationId");

            if (file.Length > AppConstraints.MaxSlidesFileSizeBytes) return Results.BadRequest("File too large");
            if (!AppConstraints.AllowedSlidesTypes.Contains(file.ContentType)) return Results.BadRequest("Unsupported file type");
            if (file.FileName.Length > AppConstraints.FileNameMaxLength) return Results.BadRequest("File name too long");

            IReadOnlyList<RenderedPage> pages;
            try
            {
                using var stream = file.OpenReadStream();
                pages = pdfRenderService.RenderPdf(stream, AppConstraints.MaxSlidesPageCount);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(ex.Message);
            }
            catch (ArgumentOutOfRangeException)
            {
                return Results.BadRequest($"PDF has too many pages. Maximum allowed is {AppConstraints.MaxSlidesPageCount}.");
            }

            try
            {
                var (slides, item) = await slidesService.AddSlidesAsync(orgId, presentationId, file.FileName, pages, caller, cancellationToken);
                return Results.Ok(new
                {
                    PresentationItemId = item.Id,
                    SlidesId = slides.Id,
                    FileName = slides.FileName,
                    PageCount = slides.PageCount
                });
            }
            catch (NotSupportedException)
            {
                return Results.StatusCode(503);
            }
        }).RequireAuthorization()
          .DisableAntiforgery();

        app.MapPost("/api/upload/import-bible", async (
            HttpContext context,
            IBibleService bibleService,
            CancellationToken cancellationToken) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            var (file, orgId) = await ReadUploadAsync(context, cancellationToken);
            if (file is null) return Results.BadRequest();
            if (orgId is null) return Results.BadRequest("Missing organizationId");

            if (file.Length > AppConstraints.MaxBibleFileSizeBytes) return Results.BadRequest("File too large");
            if (!file.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) return Results.BadRequest("Only .zip files are supported");

            try
            {
                using var stream = file.OpenReadStream();
                var result = await bibleService.ImportBibleAsync(stream, orgId, caller);
                return Results.Ok(new { result.BibleName, result.VerseCount, result.Replaced });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(ex.Message);
            }
        }).RequireAuthorization()
          .DisableAntiforgery();

        app.MapPost("/api/upload/import-songs", async (
            HttpContext context,
            ISongService songService,
            CancellationToken cancellationToken) =>
        {
            var caller = GetCaller(context);
            if (caller is null) return Results.Unauthorized();

            if (!context.Request.HasFormContentType) return Results.BadRequest();
            var form = await context.Request.ReadFormAsync(cancellationToken);

            var orgId = form["organizationId"].ToString();
            if (string.IsNullOrEmpty(orgId)) return Results.BadRequest("Missing organizationId");

            var files = new List<(string FileName, byte[] Data)>();
            foreach (var file in form.Files)
            {
                if (!file.FileName.EndsWith(".pro", StringComparison.OrdinalIgnoreCase)) continue;
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms, cancellationToken);
                files.Add((file.FileName, ms.ToArray()));
            }

            if (files.Count == 0) return Results.BadRequest("No .pro files");

            var replaceExisting = form.TryGetValue("replaceExisting", out var val) && val == "true";

            if (!replaceExisting)
            {
                var parsedNames = files
                    .Select(f => ProPresenterParser.Parse(f.Data, Path.GetFileNameWithoutExtension(f.FileName)))
                    .Where(s => s is not null)
                    .Select(s => s!.Name)
                    .ToList();

                var duplicates = await songService.FindDuplicateNamesAsync(parsedNames, orgId, caller);
                if (duplicates.Count > 0)
                    return Results.Ok(new { Duplicates = duplicates });
            }

            var result = await songService.ImportProPresenterFilesAsync(files, orgId, caller, replaceExisting);

            return Results.Ok(new { result.Imported, result.Skipped, result.Replaced });
        }).RequireAuthorization()
          .DisableAntiforgery();
    }

    private static CallerContext? GetCaller(HttpContext context)
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return null;

        var orgId = context.User.FindFirst("organization_id")?.Value;
        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        return new CallerContext(userId, role, orgId);
    }

    private static async Task<(IFormFile? File, string? OrganizationId)> ReadUploadAsync(HttpContext context, CancellationToken cancellationToken)
    {
        if (!context.Request.HasFormContentType) return (null, null);
        var form = await context.Request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");
        if (file is null || file.Length == 0) return (null, null);
        var orgId = form["organizationId"].ToString();
        return (file, string.IsNullOrEmpty(orgId) ? null : orgId);
    }
}
