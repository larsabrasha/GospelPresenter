using GospelPresenter.Shared.State;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Copies the built-in themes' background art into object storage at deploy time, in the same two
/// variants uploaded images use. Keys carry the content hash, so an unchanged asset is skipped and a
/// changed one lands beside the old object rather than replacing it — projectors that cached the old URL
/// keep working until they ask for the new one.
///
/// Failure is not fatal: the endpoint serving these assets falls back to the copy embedded in the
/// application, which is what happens in development, in the tests and in the screenshot tool, where no
/// object storage is configured at all.
/// </summary>
public class ThemeAssetUploader(
    IThemeAssetService assets,
    IImageResizeService resizer,
    ILogger<ThemeAssetUploader> logger)
{
    public async Task UploadAsync(IObjectStorageService storage, CancellationToken cancellationToken = default)
    {
        foreach (var image in BackgroundImages())
        {
            var bytes = assets.ReadAsset(image.Value);
            if (bytes is null)
            {
                logger.LogWarning("Theme asset {Asset} is missing from the application", image.Value);
                continue;
            }

            var (full, thumb, contentType) = resizer.Resize(new MemoryStream(bytes), "image/webp");

            await UploadIfMissingAsync(storage, image, "full", full, contentType, cancellationToken);
            await UploadIfMissingAsync(storage, image, "thumb", thumb, contentType, cancellationToken);
        }
    }

    private async Task UploadIfMissingAsync(
        IObjectStorageService storage,
        SlideBackgroundImage image,
        string variant,
        byte[] data,
        string contentType,
        CancellationToken cancellationToken)
    {
        var key = ImageUrlHelper.ThemeAssetKey(image.Value, variant, image.ContentHash);

        var existing = await storage.GetAsync(key, cancellationToken);
        if (existing is not null)
        {
            await existing.Value.Stream.DisposeAsync();
            return;
        }

        await storage.UploadAsync(key, data, contentType, cancellationToken);
        logger.LogInformation("Uploaded theme asset {Key}", key);
    }

    private static IEnumerable<SlideBackgroundImage> BackgroundImages() =>
        BuiltInThemes.All
            .SelectMany(theme => new[]
            {
                theme.Definition.Song.Background.Image,
                theme.Definition.BibleText.Background.Image,
                theme.Definition.Media.Image
            })
            .Where(image => image is { Source: SlideImageSource.BuiltInAsset })
            .Select(image => image!)
            .DistinctBy(image => (image.Value, image.ContentHash));
}
