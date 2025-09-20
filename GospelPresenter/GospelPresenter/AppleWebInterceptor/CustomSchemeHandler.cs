#if IOS || MACCATALYST

using System.Collections.Concurrent;
using System.Net.Http.Headers;
using GospelPresenter.Configuration;
using GospelPresenter.Services.Cache;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Utils;
using Foundation;
using Microsoft.Extensions.Logging;
using WebKit;

namespace GospelPresenter.AppleWebInterceptor;

public class CustomSchemeHandler(ITileDataCacheService tileDataCacheService, AppState appState, ILogger<CustomSchemeHandler> logger, IHeaderService headerService) : NSObject, IWKUrlSchemeHandler
{
    private readonly ConcurrentDictionary<IWKUrlSchemeTask, bool> cancelledTasks = new();

    // - IWKUrlSchemeHandler

    public void StartUrlSchemeTask(WKWebView webView, IWKUrlSchemeTask urlSchemeTask)
    {
        logger.LogDebug("Handling request with URL: {RequestUrl}", urlSchemeTask.Request.Url);
        _ = HandleRequestAsync(urlSchemeTask);
    }

    public void StopUrlSchemeTask(WKWebView webView, IWKUrlSchemeTask urlSchemeTask)
    {
        cancelledTasks.TryAdd(urlSchemeTask, true);
    }

    // - Private methods

    private async Task HandleRequestAsync(IWKUrlSchemeTask urlSchemeTask)
    {
        try
        {
            var url = urlSchemeTask.Request.Url.ToString().Replace("gf://", "https://");
            
            var httpRequestMessage = CreateHttpRequestMessage(urlSchemeTask, url);
            var httpRequestResponse = await tileDataCacheService.GetOrSetTileAsync(url, httpRequestMessage);

            if (!cancelledTasks.ContainsKey(urlSchemeTask))
            {
                urlSchemeTask.DidReceiveResponse(ConvertToNsUrlResponse(httpRequestResponse));
                urlSchemeTask.DidReceiveData(NSData.FromArray(httpRequestResponse.Data));
                urlSchemeTask.DidFinish();
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error handling URL");
            if (!cancelledTasks.ContainsKey(urlSchemeTask))
            {
                urlSchemeTask.DidFailWithError(NSError.FromDomain(new NSString("CustomSchemeHandler"), -1));
            }
        }
        finally
        {
            cancelledTasks.TryRemove(urlSchemeTask, out _);
        }
    }

    private HttpRequestMessage CreateHttpRequestMessage(IWKUrlSchemeTask urlSchemeTask, string url)
    {
        var httpRequestMessage = ConvertNsUrlRequestToHttpRequest(urlSchemeTask.Request);
        httpRequestMessage.RequestUri = new Uri(url);
                
        foreach (var (headerKey, value) in headerService.AppHeaders)
        {
            httpRequestMessage.Headers.TryAddWithoutValidation(headerKey, value);
        }
        
        // if (appState.LoggedInUser?.Token is not null)
        // {
        //     httpRequestMessage.Headers.Authorization =
        //         new AuthenticationHeaderValue("Bearer", appState.LoggedInUser.Token);
        // }

        return httpRequestMessage;
    }

    private static HttpRequestMessage ConvertNsUrlRequestToHttpRequest(NSUrlRequest nsUrlRequest)
    {
        var httpRequestMessage = new HttpRequestMessage
        {
            RequestUri = new Uri(nsUrlRequest.Url.AbsoluteString!),
            Method = new HttpMethod(nsUrlRequest.HttpMethod)
        };

        foreach (var header in nsUrlRequest.Headers)
        {
            var headerKey = header.Key.ToString();
            var headerValue = header.Value.ToString();
            httpRequestMessage.Headers.TryAddWithoutValidation(headerKey, headerValue);
        }

        return httpRequestMessage;
    }

    private static NSHttpUrlResponse ConvertToNsUrlResponse(HttpResponseCacheItem httpResponseCacheItem)
    {
        var headerFields = new NSMutableDictionary();
        foreach (var header in httpResponseCacheItem.Headers)
        {
            headerFields.SetValueForKey(new NSString(header.Value), new NSString(header.Key));
        }

        return new NSHttpUrlResponse(
            new Uri(httpResponseCacheItem.Url)!,
            httpResponseCacheItem.StatusCode,
            httpResponseCacheItem.HttpVersion,
            headerFields
        );
    }
}

#endif
