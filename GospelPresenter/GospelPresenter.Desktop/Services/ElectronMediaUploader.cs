using ElectronNET.API;
using ElectronNET.API.Entities;
using GospelPresenter.Shared;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Localization;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// The desktop's upload path: Electron's native open dialog, then the shared
/// <see cref="MediaIngestService"/>. The /api/upload endpoints the web posts to do not exist in
/// this host — its HTTP server only serves the app and its media — so files go through the domain
/// services directly, into the local store, and the sync engine pushes them later.
/// </summary>
public class ElectronMediaUploader(
    MediaIngestService ingest,
    IStringLocalizer<SharedResource> localizer,
    ILogger<ElectronMediaUploader> logger) : IMediaUploader
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

    private async Task<List<PickedFile>> PickAsync(bool isAudio, bool allowMultiple)
    {
        // The dialog is presented from the operator's window — the one that was created first. A
        // sheet on the projector window would be shown to the congregation.
        var owner = Electron.WindowManager.BrowserWindows.OrderBy(w => w.Id).FirstOrDefault();
        if (owner is null)
        {
            logger.LogWarning("No window to present the file picker from");
            return [];
        }

        var properties = allowMultiple
            ? new[] { OpenDialogProperty.openFile, OpenDialogProperty.multiSelections }
            : [OpenDialogProperty.openFile];

        var paths = await Electron.Dialog.ShowOpenDialogAsync(owner, new OpenDialogOptions
        {
            Title = localizer[isAudio ? "FilePicker.ChooseAudio" : "FilePicker.ChooseImages"],
            Properties = properties,
            Filters =
            [
                new FileFilter
                {
                    Name = localizer[isAudio ? "FilePicker.AudioFiles" : "FilePicker.ImageFiles"],
                    Extensions = isAudio ? MediaIngestService.AudioExtensions : MediaIngestService.ImageExtensions,
                },
            ],
        });

        logger.LogDebug("The picker returned {Count} file(s)", paths?.Length ?? 0);
        return [.. (paths ?? []).Select(Describe).OfType<PickedFile>()];
    }

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
}
