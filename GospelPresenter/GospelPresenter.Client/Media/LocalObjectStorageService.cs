using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Media;

/// <summary>
/// The device's IObjectStorageService: the shared domain services upload, read and delete blobs
/// exactly as on the web, but against the local media store. New blobs are queued for upload; a
/// read that misses locally is fetched from the server once and cached. Deletes are local only —
/// the server deletes its own blobs when the metadata delete arrives through the sync push.
/// </summary>
public class LocalObjectStorageService(
    MediaStore store,
    IMediaDownloader downloader,
    ILogger<LocalObjectStorageService> logger) : IObjectStorageService
{
    public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
        store.SaveAsync(key, data, contentType, MediaCacheState.PendingUpload, pinned: false, cancellationToken);

    public async Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        var local = await store.GetAsync(key, cancellationToken);
        if (local is not null)
            return local;

        var downloaded = await downloader.DownloadAsync(key, cancellationToken);
        if (downloaded is null)
            return null;

        logger.LogDebug("Fetched {Key} from the server on demand", key);
        await store.SaveAsync(key, downloaded.Value.Data, downloaded.Value.ContentType,
            MediaCacheState.Cached, pinned: false, cancellationToken);
        return await store.GetAsync(key, cancellationToken);
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken = default) =>
        store.DeleteAsync(key, cancellationToken);

    public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
        store.DeleteByPrefixAsync(prefix, cancellationToken);

    public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
        store.CopyByPrefixAsync(sourcePrefix, destPrefix, cancellationToken);
}
