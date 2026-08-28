using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Media;

/// <summary>Fetches a blob the local store does not have from the server. Null when it cannot.</summary>
public interface IMediaDownloader
{
    Task<(byte[] Data, string ContentType)?> DownloadAsync(string key, CancellationToken cancellationToken = default);
}

/// <summary>Downloads over the same authenticated HttpClient the sync engine uses.</summary>
public class HttpMediaDownloader(HttpClient http, ILogger<HttpMediaDownloader> logger) : IMediaDownloader
{
    public async Task<(byte[] Data, string ContentType)?> DownloadAsync(string key, CancellationToken cancellationToken = default)
    {
        var url = MediaUrlResolver.ServerUrlForKey(key);
        if (url is null)
            return null;

        try
        {
            using var response = await http.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogDebug("Media download of {Key} answered {Status}", key, response.StatusCode);
                return null;
            }

            var data = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            var contentType = response.Content.Headers.ContentType?.MediaType ?? "application/octet-stream";
            return (data, contentType);
        }
        catch (HttpRequestException e)
        {
            logger.LogDebug("Media download of {Key} failed: {Message}", key, e.Message);
            return null;
        }
    }
}

/// <summary>For installs without a server (the DEBUG developer identity): local blobs only.</summary>
public class NullMediaDownloader : IMediaDownloader
{
    public Task<(byte[] Data, string ContentType)?> DownloadAsync(string key, CancellationToken cancellationToken = default) =>
        Task.FromResult<(byte[], string)?>(null);
}
