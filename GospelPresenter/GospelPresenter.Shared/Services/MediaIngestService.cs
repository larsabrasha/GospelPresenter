using System.Text.Json;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

/// <summary>A file the user chose, and the MIME type the domain services expect for it.</summary>
public sealed record PickedFile(string FileName, string ContentType, Func<Task<Stream>> Open);

/// <summary>
/// A file the browser handed over from a drop. The name is all it tells us up front; the bytes
/// come over the interop channel when the file's turn to be ingested arrives.
/// </summary>
public sealed record DroppedFile(string FileName, Func<Task<Stream>> Open);

/// <summary>
/// Everything an <see cref="IMediaUploader"/> does once the user has chosen files: the same size
/// and type limits the /api/upload endpoints enforce, the same resize, the same domain services.
/// The blobs land in the local store, which queues them for the sync engine to push, so an upload
/// works with no network at all.
///
/// Only picking the files differs between hosts — a native dialog on each platform — so only that
/// is left to them. The JSON handed to the Uploaded callback mirrors each endpoint's response
/// exactly, because the components deserialise it with the same <see cref="UploadResult"/> either
/// way.
/// </summary>
public class MediaIngestService(
    IOrganizationImageService imageService,
    IOrganizationAudioService audioService,
    IImageResizeService imageResizeService,
    IPresentationService presentationService,
    IObjectStorageService storage,
    ActiveOrganizationState orgState,
    ILogger<MediaIngestService> logger)
{
    /// <summary>
    /// Ingests each file in turn, reporting progress through the callbacks the components already
    /// use for the web's JS uploader. One file failing does not stop the rest.
    /// </summary>
    public async Task UploadAllAsync(MediaUploadTarget target, IReadOnlyList<PickedFile> files,
        MediaUploadCallbacks callbacks, CancellationToken cancellationToken = default)
    {
        if (files.Count == 0)
        {
            // Cancelling must still clear the busy state the component set before calling us.
            callbacks.Completed();
            return;
        }

        callbacks.Started(files.Count);

        foreach (var file in files)
        {
            try
            {
                var json = await IngestAsync(target, file, cancellationToken);
                if (json is null)
                    callbacks.Failed(file.FileName);
                else
                    callbacks.Uploaded(json);
            }
            catch (Exception e)
            {
                logger.LogError(e, "Uploading {FileName} failed", file.FileName);
                callbacks.Failed(file.FileName);
            }
        }

        callbacks.Completed();
    }

    /// <summary>
    /// Ingests files a browser handed over from a drop. Only where the files came from differs:
    /// the extension decides the type exactly as it does for a picked file, and an extension with
    /// no type reaches <see cref="UploadAllAsync"/> as a rejected file rather than vanishing.
    /// </summary>
    public Task UploadDroppedAsync(MediaUploadTarget target, IReadOnlyList<DroppedFile> files,
        MediaUploadCallbacks callbacks, CancellationToken cancellationToken = default) =>
        UploadAllAsync(target,
            [.. files.Select(file => new PickedFile(file.FileName, ContentTypeFor(file.FileName) ?? "", file.Open))],
            callbacks, cancellationToken);

    /// <summary>
    /// The extension decides the type, matching the accept lists the web sends: pickers report a
    /// UTI or nothing at all, and the domain services and AppConstraints speak MIME.
    /// </summary>
    public static string? ContentTypeFor(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".mp3" => "audio/mpeg",
            ".wav" => "audio/wav",
            ".ogg" => "audio/ogg",
            ".m4a" => "audio/x-m4a",
            ".mp4" or ".m4b" => "audio/mp4",
            ".webm" => "audio/webm",
            _ => null,
        };

    /// <summary>The extensions a picker should offer, for the two kinds of upload.</summary>
    public static readonly string[] ImageExtensions = ["jpg", "jpeg", "png", "webp", "gif"];

    public static readonly string[] AudioExtensions = ["mp3", "wav", "ogg", "m4a", "mp4", "m4b", "webm"];

    private async Task<string?> IngestAsync(MediaUploadTarget target, PickedFile file, CancellationToken cancellationToken)
    {
        var isAudio = target.Kind == MediaUploadKind.OrganizationAudio;
        var maxSize = isAudio ? AppConstraints.MaxAudioFileSizeBytes : AppConstraints.MaxImageFileSizeBytes;
        var allowed = isAudio ? AppConstraints.AllowedAudioTypes : AppConstraints.AllowedImageTypes;

        if (!allowed.Contains(file.ContentType) || file.FileName.Length > AppConstraints.FileNameMaxLength)
        {
            logger.LogWarning("Rejected {FileName}: type {ContentType}", file.FileName, file.ContentType);
            return null;
        }

        using var buffer = new MemoryStream();
        await using (var source = await file.Open())
            await source.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length > maxSize)
        {
            logger.LogWarning("Rejected {FileName}: {Size} bytes exceeds the limit", file.FileName, buffer.Length);
            return null;
        }

        var caller = orgState.ToCallerContext();

        switch (target.Kind)
        {
            case MediaUploadKind.OrganizationImage:
            {
                buffer.Position = 0;
                var (fullData, thumbData, resizedType) = imageResizeService.Resize(buffer, file.ContentType);
                var image = await imageService.AddImageAsync(target.OrganizationId, file.FileName, resizedType,
                    thumbData, fullData, caller, cancellationToken);
                return JsonSerializer.Serialize(
                    new { image.Id, image.FileName, image.ContentType, image.CreatedAt }, UploadResult.JsonOptions);
            }

            case MediaUploadKind.OrganizationAudio:
            {
                var audio = await audioService.AddAudioAsync(target.OrganizationId, file.FileName, file.ContentType,
                    buffer.ToArray(), caller, cancellationToken);
                return JsonSerializer.Serialize(
                    new { audio.Id, audio.FileName, audio.ContentType, audio.CreatedAt }, UploadResult.JsonOptions);
            }

            case MediaUploadKind.OverlayImage:
            {
                if (target.OverlayId is null)
                    return null;
                var overlay = await presentationService.GetOverlayByIdAsync(target.OverlayId, target.OrganizationId,
                    caller, cancellationToken);
                if (overlay is null)
                    return null;

                var key = ImageUrlHelper.OverlayImageKey(target.OrganizationId, target.OverlayId);
                await storage.UploadAsync(key, buffer.ToArray(), file.ContentType, cancellationToken);

                overlay.HasImage = true;
                overlay.ImageData = null;
                overlay.ImageContentType = null;
                await presentationService.UpdateOverlayAsync(target.OrganizationId, overlay, caller, cancellationToken);

                return JsonSerializer.Serialize(
                    new { overlayId = target.OverlayId, hasImage = true }, UploadResult.JsonOptions);
            }

            default:
                return null;
        }
    }
}
