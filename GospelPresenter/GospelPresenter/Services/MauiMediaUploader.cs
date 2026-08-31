using GospelPresenter.Shared;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Localization;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging;
#if IOS
using UIKit;
using UniformTypeIdentifiers;
#endif

namespace GospelPresenter.Services;

/// <summary>
/// The device's upload path: pick files with the platform's own dialog, then hand them to
/// <see cref="MediaIngestService"/>, which does everything the web's /api/upload endpoints do.
/// There is no server here to POST to — a relative URL in the webview resolves against its own
/// origin and reaches nothing.
/// </summary>
public class MauiMediaUploader(
    MediaIngestService ingest,
    IStringLocalizer<SharedResource> localizer,
    ILogger<MauiMediaUploader> logger) : IMediaUploader
{
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

        await ingest.UploadAllAsync(target, files, callbacks, cancellationToken);
    }

#if IOS
    /// <summary>
    /// Presents the document picker directly rather than through MAUI's FilePicker. MAUI still
    /// builds its picker with UIDocumentPickerMode.Import, deprecated since iOS 14, and listens for
    /// the old single-document callback. asCopy gives files the app already owns, so there is no
    /// security-scoped bookmark to hold open while they are read.
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
        var contentType = MediaIngestService.ContentTypeFor(name);
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
        var contentType = MediaIngestService.ContentTypeFor(file.FileName);
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
}
