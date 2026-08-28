using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Media;

/// <summary>The media leg of a sync cycle, run by the scheduler after the metadata sync.</summary>
public interface IMediaSynchronizer
{
    Task SyncAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Pushes locally created blobs to PUT /api/sync/media/{key} — the metadata rows travelled in the
/// sync push just before, so the server can already account for them — then reconciles the pinned
/// download set against the freshly pulled metadata. A blob the server refuses (permissions, a
/// malformed key) is logged and left pending: it retries next cycle and is never evicted.
/// </summary>
public class MediaSynchronizer(
    MediaStore store,
    HttpClient http,
    MediaPinService pins,
    ILogger<MediaSynchronizer> logger,
    Bibles.BibleOfflineService? bibles = null) : IMediaSynchronizer
{
    public async Task SyncAsync(CancellationToken cancellationToken = default)
    {
        foreach (var pending in await store.GetPendingUploadsAsync(cancellationToken))
        {
            byte[] bytes;
            try
            {
                bytes = await store.ReadBytesAsync(pending, cancellationToken);
            }
            catch (IOException e)
            {
                logger.LogWarning(e, "The pending upload {Key} could not be read; dropping it", pending.Key);
                await store.DeleteAsync(pending.Key, cancellationToken);
                continue;
            }

            using var content = new ByteArrayContent(bytes);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(pending.ContentType);
            using var response = await http.PutAsync($"/api/sync/media/{pending.Key}", content, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                await store.MarkUploadedAsync(pending.Key, cancellationToken);
            }
            else
            {
                logger.LogWarning("The server answered {Status} for the media upload {Key}; it stays queued",
                    response.StatusCode, pending.Key);
            }
        }

        await pins.ReconcileAsync(cancellationToken);

        // Pinned Bible translations follow the same cadence: the pull just before may have moved
        // a pinned Bible's ModifiedAt past the downloaded version.
        if (bibles is not null)
            await bibles.RefreshStaleAsync(cancellationToken);
    }
}
