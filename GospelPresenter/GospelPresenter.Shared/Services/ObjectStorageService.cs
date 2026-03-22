using Amazon.S3;
using Amazon.S3.Model;
using GospelPresenter.Shared.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Shared.Services;

public interface IObjectStorageService
{
    Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default);
    Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default);
    Task DeleteAsync(string key, CancellationToken cancellationToken = default);
    Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default);
}

public class ObjectStorageService : IObjectStorageService, IDisposable
{
    private readonly IAmazonS3 client;
    private readonly string bucketName;
    private readonly ILogger<ObjectStorageService> logger;

    public ObjectStorageService(IOptions<S3Options> options, ILogger<ObjectStorageService> logger)
    {
        this.logger = logger;
        var opts = options.Value;
        bucketName = opts.BucketName;

        var config = new AmazonS3Config
        {
            ServiceURL = opts.Endpoint,
            AuthenticationRegion = opts.Region,
            ForcePathStyle = true,
        };

        client = new AmazonS3Client(opts.AccessKey, opts.SecretKey, config);
    }

    public async Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default)
    {
        using var stream = new MemoryStream(data);
        var request = new PutObjectRequest
        {
            BucketName = bucketName,
            Key = key,
            InputStream = stream,
            ContentType = contentType,
            UseChunkEncoding = false,
        };

        await client.PutObjectAsync(request, cancellationToken);
        logger.LogDebug("Uploaded {Key} ({Size} bytes)", key, data.Length);
    }

    public async Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await client.GetObjectAsync(bucketName, key, cancellationToken);
            var contentType = response.Headers.ContentType ?? "application/octet-stream";
            return (response.ResponseStream, contentType);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken = default)
    {
        try
        {
            await client.DeleteObjectAsync(bucketName, key, cancellationToken);
            logger.LogDebug("Deleted {Key}", key);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // Object already deleted or never existed — not an error
        }
    }

    public async Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
    {
        var request = new ListObjectsV2Request
        {
            BucketName = bucketName,
            Prefix = prefix,
        };

        var totalDeleted = 0;
        ListObjectsV2Response response;
        do
        {
            response = await client.ListObjectsV2Async(request, cancellationToken);

            if (response.S3Objects.Count > 0)
            {
                var deleteRequest = new DeleteObjectsRequest
                {
                    BucketName = bucketName,
                    Objects = response.S3Objects.Select(o => new KeyVersion { Key = o.Key }).ToList()
                };
                await client.DeleteObjectsAsync(deleteRequest, cancellationToken);
            }

            totalDeleted += response.S3Objects.Count;
            request.ContinuationToken = response.NextContinuationToken;
        } while (response.IsTruncated == true);

        logger.LogDebug("Deleted {Count} objects with prefix {Prefix}", totalDeleted, prefix);
    }

    public void Dispose()
    {
        client.Dispose();
    }
}

/// <summary>
/// Fallback for environments without S3 configuration (e.g. MAUI).
/// All operations throw so misconfiguration is caught early.
/// </summary>
public class NullObjectStorageService : IObjectStorageService
{
    private static NotSupportedException NotConfigured() =>
        new("Object storage is not configured. Provide S3 settings to enable image storage.");

    public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default)
        => throw NotConfigured();

    public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default)
        => throw NotConfigured();

    public Task DeleteAsync(string key, CancellationToken cancellationToken = default)
        => throw NotConfigured();

    public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
        => throw NotConfigured();
}
