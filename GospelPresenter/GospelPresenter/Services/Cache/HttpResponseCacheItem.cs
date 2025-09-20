using Microsoft.Net.Http.Headers;

namespace GospelPresenter.Services.Cache;

public record HttpResponseCacheItem(
    string Url,
    string HttpVersion,
    string ContentType,
    string Charset,
    int StatusCode,
    string ReasonPhrase,
    byte[] Data,
    IDictionary<string, string> Headers
)
{
    public static HttpResponseCacheItem Create(
        string url,
        string httpVersion,
        HttpResponseMessage httpResponseMessage,
        byte[] data
    )
    {
        var headers = httpResponseMessage.Headers.ToDictionary(
            h => h.Key,
            h => string.Join(", ", h.Value)
        );
        return new HttpResponseCacheItem(
            url,
            httpVersion,
            httpResponseMessage.Content.Headers.ContentType?.MediaType ?? string.Empty,
            httpResponseMessage.Content.Headers.ContentType?.CharSet ?? string.Empty,
            (int)httpResponseMessage.StatusCode,
            httpResponseMessage.ReasonPhrase ?? string.Empty,
            data,
            headers
        );
    }
};
