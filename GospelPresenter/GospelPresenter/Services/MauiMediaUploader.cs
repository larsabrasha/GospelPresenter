using System.Text.Json;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Localization;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging;
#if MACCATALYST || IOS
using Foundation;
using UIKit;
using UniformTypeIdentifiers;
#endif

namespace GospelPresenter.Services;

/// <summary>
/// The device's upload path. The web posts files to /api/upload/*; there is no server here, so
/// this picks files natively and runs the same steps those endpoints run — the same size and type
/// limits, the same resize, the same domain services. The blobs land in the local store, which
/// queues them for the sync engine to push, so an upload works with no network at all.
///
/// The JSON handed to the Uploaded callback mirrors each endpoint's response exactly, because the
/// components deserialise it with the same <see cref="UploadResult"/> either way.
/// </summary>
public class MauiMediaUploader(
    IOrganizationImageService imageService,
    IOrganizationAudioService audioService,
    IImageResizeService imageResizeService,
    IPresentationService presentationService,
    IObjectStorageService storage,
    ActiveOrganizationState orgState,
    IStringLocalizer<SharedResource> localizer,
    ILogger<MauiMediaUploader> logger) : IMediaUploader
{
    /// <summary>A chosen file and the MIME type the domain services expect for it.</summary>
    private sealed record PickedFile(string FileName, string ContentType, Func<Task<Stream>> Open);

    public async Task PickAndUploadAsync(MediaUploadTarget target, MediaUploadCallbacks callbacks,
        CancellationToken cancellationToken = default)
    {
        var isAudio = target.Kind == MediaUploadKind.OrganizationAudio;
        // Overlays hold a single image; the other two libraries take a batch.
        var allowMultiple = target.Kind != MediaUploadKind.OverlayImage;

        List<PickedFile> files;
        try
        {
            files = await PickAsync(isAudio, allowMultiple);
        }
        catch (Exception e)
        {
            logger.LogError(e, "The file picker could not be opened");
            callbacks.Completed();
            return;
        }

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

#if MACCATALYST || IOS
    /// <summary>
    /// Presents the document picker directly rather than through MAUI's FilePicker. MAUI still
    /// builds its picker with UIDocumentPickerMode.Import, deprecated since iOS 14, and listens for
    /// the old single-document callback; macOS calls the plural one, so the picker opens, the user
    /// chooses, and PickMultipleAsync hands back an empty list. This uses the current initialiser
    /// and the plural event. asCopy gives files the app already owns, so there is no security-scoped
    /// bookmark to hold open while they are read.
    ///
    /// The dialog also needs the sandbox entitlements in Platforms/MacCatalyst/Entitlements.plist:
    /// without them it never becomes visible at all, whichever API presents it.
    /// </summary>
    private Task<List<PickedFile>> PickAsync(bool isAudio, bool allowMultiple) =>
        MainThread.InvokeOnMainThreadAsync(() =>
        {
            var completion = new TaskCompletionSource<List<PickedFile>>();

            var controller = WindowStateManager.Default.GetCurrentUIViewController();
            if (controller is null)
            {
                logger.LogWarning("No view controller to present the file picker from");
                completion.SetResult([]);
                return completion.Task;
            }

            var types = isAudio ? new[] { UTTypes.Audio } : new[] { UTTypes.Image };
            var picker = new UIDocumentPickerViewController(types, asCopy: true)
            {
                AllowsMultipleSelection = allowMultiple,
            };

            picker.DidPickDocumentAtUrls += (_, args) =>
            {
                var paths = args.Urls.Select(u => u.Path).OfType<string>().ToList();
                logger.LogDebug("The picker returned {Count} file(s)", paths.Count);
                completion.TrySetResult([.. paths.Select(Describe).OfType<PickedFile>()]);
            };
            picker.WasCancelled += (_, _) => completion.TrySetResult([]);

            logger.LogDebug("Opening the file picker (audio: {IsAudio}, multiple: {Multiple})", isAudio, allowMultiple);
            controller.PresentViewController(picker, animated: true, completionHandler: null);
            return completion.Task;
        });

    private PickedFile? Describe(string path)
    {
        var name = Path.GetFileName(path);
        var contentType = ContentTypeFor(name);
        if (contentType is null)
        {
            logger.LogWarning("No known content type for {FileName}", name);
            return null;
        }
        return new PickedFile(name, contentType, () => Task.FromResult<Stream>(File.OpenRead(path)));
    }
#else
    private async Task<List<PickedFile>> PickAsync(bool isAudio, bool allowMultiple)
    {
        var options = new PickOptions
        {
            PickerTitle = localizer[isAudio ? "FilePicker.ChooseAudio" : "FilePicker.ChooseImages"],
            FileTypes = isAudio ? AudioFileTypes : FilePickerFileType.Images,
        };
        var results = allowMultiple
            ? await FilePicker.Default.PickMultipleAsync(options)
            : [await FilePicker.Default.PickAsync(options)];
        return [.. (results ?? []).OfType<FileResult>().Select(Describe).OfType<PickedFile>()];
    }

    private PickedFile? Describe(FileResult file)
    {
        var contentType = ContentTypeFor(file.FileName);
        if (contentType is null)
        {
            logger.LogWarning("No known content type for {FileName}", file.FileName);
            return null;
        }
        return new PickedFile(file.FileName, contentType, file.OpenReadAsync);
    }

    private static readonly FilePickerFileType AudioFileTypes = new(
        new Dictionary<DevicePlatform, IEnumerable<string>>
        {
            [DevicePlatform.Android] = ["audio/*"],
            [DevicePlatform.WinUI] = [".mp3", ".m4a", ".wav", ".aac", ".ogg"],
        });
#endif

    /// <summary>
    /// The extension decides the type, matching the accept lists the web sends: the picker reports
    /// a UTI, and the domain services and AppConstraints speak MIME.
    /// </summary>
    private static string? ContentTypeFor(string path) =>
        System.IO.Path.GetExtension(path).ToLowerInvariant() switch
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
