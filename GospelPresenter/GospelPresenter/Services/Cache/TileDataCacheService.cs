using System.Net;
using System.Reflection;
using Microsoft.Net.Http.Headers;
using ZiggyCreatures.Caching.Fusion;
using EntityTagHeaderValue = System.Net.Http.Headers.EntityTagHeaderValue;

namespace GospelPresenter.Services.Cache;

public interface ITileDataCacheService
{
    Task<HttpResponseCacheItem> GetOrSetTileAsync(
        string url,
        HttpRequestMessage httpRequestMessage,
        CancellationToken cancellationToken = default
    );
    
    HttpResponseCacheItem GetOrSetTile(
        string url,
        HttpRequestMessage httpRequestMessage,
        CancellationToken cancellationToken = default
    );
}

public class TileDataCacheService(IFusionCache fusionCache, IHttpClientFactory httpClientFactory)
    : ITileDataCacheService
{
    private readonly HttpResponseCacheItem fallbackCacheItem = new(
        string.Empty,
        "1.1",
        "image/png",
        "utf-8",
        200,
        "OK",
        StreamToBytes(Assembly.GetExecutingAssembly().GetManifestResourceStream("GospelPresenter.Resources.transparent.png")!),
        new Dictionary<string, string>()
    );

    public async Task<HttpResponseCacheItem> GetOrSetTileAsync(string url,
        HttpRequestMessage httpRequestMessage,
        CancellationToken cancellationToken = default)
    {
        var existingValue = await fusionCache.GetOrDefaultAsync<HttpResponseCacheItem>(
            url,
            null,
            options => options.SetAllowStaleOnReadOnly(),
            cancellationToken
        );
        
        if (Connectivity.Current.NetworkAccess != NetworkAccess.Internet)
        {
            return ConfigureCacheItemForWebView(existingValue ?? fallbackCacheItem);
        }
        
        var cacheItem = await fusionCache.GetOrSetAsync(
            url,
            async (context, innerCancellationToken) =>
            {
                using var linkedTokenSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, innerCancellationToken);
                var combinedCancellationToken = linkedTokenSource.Token;
                
                if (existingValue is not null && existingValue.Headers.TryGetValue(HeaderNames.ETag, out var eTag))
                {
                    httpRequestMessage.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(eTag));
                }
                
                try
                {
                    var httpClient = httpClientFactory.CreateClient();
                    var httpResponseMessage = await httpClient.SendAsync(httpRequestMessage, HttpCompletionOption.ResponseHeadersRead, combinedCancellationToken);
                    if (!httpResponseMessage.IsSuccessStatusCode)
                    {
                        return context.Fail("Error fetching tile");
                    }
                
                    if (existingValue is not null && httpResponseMessage.StatusCode == HttpStatusCode.NotModified)
                    {
                        return existingValue;
                    }
                
                    var data = await httpResponseMessage.Content.ReadAsByteArrayAsync(combinedCancellationToken);
                
                    return HttpResponseCacheItem.Create(
                        httpRequestMessage.RequestUri!.ToString(),
                        httpRequestMessage.Version.ToString(),
                        httpResponseMessage,
                        data
                    );
                }
                catch
                {
                    return context.Fail("Error fetching tile");
                }
            },
            MaybeValue<HttpResponseCacheItem>.FromValue(fallbackCacheItem),
            options => GetTileCacheOptions(options),
            cancellationToken
        );

        return ConfigureCacheItemForWebView(cacheItem);
    }
    
    public HttpResponseCacheItem GetOrSetTile(
        string url,
        HttpRequestMessage httpRequestMessage,
        CancellationToken cancellationToken = default
    )
    {
        var existingValue = fusionCache.GetOrDefault<HttpResponseCacheItem>(
            url,
            null,
            options => options.SetAllowStaleOnReadOnly(),
            cancellationToken
        );
        
        if (Connectivity.Current.NetworkAccess != NetworkAccess.Internet)
        {
            return ConfigureCacheItemForWebView(existingValue ?? fallbackCacheItem);
        }
        
        var cacheItem = fusionCache.GetOrSet(
            url,
            (context, innerCancellationToken) =>
            {
                using var linkedTokenSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, innerCancellationToken);
                var combinedCancellationToken = linkedTokenSource.Token;
                
                if (existingValue is not null && existingValue.Headers.TryGetValue(HeaderNames.ETag, out var eTag))
                {
                    httpRequestMessage.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(eTag));
                }
                
                try
                {
                    var httpClient = httpClientFactory.CreateClient();
                    var httpResponseMessage = httpClient.Send(httpRequestMessage, HttpCompletionOption.ResponseHeadersRead, combinedCancellationToken);
                    if (!httpResponseMessage.IsSuccessStatusCode)
                    {
                        return context.Fail("Error fetching tile");
                    }
                
                    if (existingValue is not null && httpResponseMessage.StatusCode == HttpStatusCode.NotModified)
                    {
                        return existingValue;
                    }
                    
                    using var stream = httpResponseMessage.Content.ReadAsStream(combinedCancellationToken);
                    using var memoryStream = new MemoryStream();
                    var bufferSize = httpResponseMessage.Content.Headers.ContentLength > 0
                        ? httpResponseMessage.Content.Headers.ContentLength
                        : 81920;
                    stream.CopyTo(memoryStream, (int)bufferSize);
                    var data = memoryStream.ToArray();
                
                    return HttpResponseCacheItem.Create(
                        httpRequestMessage.RequestUri!.ToString(),
                        httpRequestMessage.Version.ToString(),
                        httpResponseMessage,
                        data
                    );
                }
                catch
                {
                    return context.Fail("Error fetching tile");
                }
            },
            MaybeValue<HttpResponseCacheItem>.FromValue(fallbackCacheItem),
            options => GetTileCacheOptions(options),
            cancellationToken
        );

        return ConfigureCacheItemForWebView(cacheItem);
    }

    private static FusionCacheEntryOptions GetTileCacheOptions(FusionCacheEntryOptions options)
    {
        options.AllowBackgroundDistributedCacheOperations = true;

        options
            .SetDistributedCacheDurationInfinite()
            .SetDurationInfinite()
            .SetFailSafe(
                true,
                TimeSpan.MaxValue,
                TimeSpan.FromMinutes(1)
            );

        return options;
    }
    
    // Making sure the WebView will complain about origin and to not cache any tiles itself 
    private static HttpResponseCacheItem ConfigureCacheItemForWebView(HttpResponseCacheItem httpResponseCacheItem)
    {
        var header = httpResponseCacheItem.Headers
            .Where(x =>
                x.Key != HeaderNames.CacheControl &&
                x.Key != HeaderNames.Expires &&
                x.Key != HeaderNames.ETag &&
                x.Key != HeaderNames.LastModified &&
                x.Key != HeaderNames.Age
            )
            .ToDictionary(
                h => h.Key,
                h => string.Join(", ", h.Value)
            );
        
        header.TryAdd(HeaderNames.AccessControlAllowOrigin, "*");
        header.TryAdd(HeaderNames.CacheControl, "no-cache, no-store, must-revalidate");
        header.TryAdd(HeaderNames.ContentType, "image/png");
        
        return httpResponseCacheItem with { Headers = header };
    }
    
    private static byte[] StreamToBytes(Stream stream)
    {
        using var ms = new MemoryStream();
        
        stream.CopyTo(ms);
        return ms.ToArray();
    }
}
