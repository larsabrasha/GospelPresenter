using System.Net.Http.Headers;
using Android.Webkit;
using GospelPresenter.Services.Cache;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Utils;
using WebView = Android.Webkit.WebView;

namespace GospelPresenter.WebInterceptor;

public class CustomWebViewClient(
    WebViewClient originalWebViewClient,
    ITileDataCacheService cacheService,
    AppState appState,
    IHeaderService headerService
) : WebViewClient
{
    public override WebResourceResponse? ShouldInterceptRequest(WebView? view, IWebResourceRequest? request)
    {
        if (request?.Url?.ToString() is { } url && url.Contains("api.gospelpresenter.com"))
        {
            try
            {
                var httpRequestResponse = cacheService.GetOrSetTile(url, ConvertToHttpRequestMessage(request, appState, headerService));
                return ConvertToWebResourceResponse(httpRequestResponse);
            }
            catch (Exception e)
            {
                Console.WriteLine(e.Message);
            }
        }

        return originalWebViewClient.ShouldInterceptRequest(view, request);
    }

    public override bool ShouldOverrideUrlLoading(WebView? view, IWebResourceRequest? request)
        => originalWebViewClient.ShouldOverrideUrlLoading(view, request);

    public override void OnPageFinished(WebView? view, string? url)
        => originalWebViewClient.OnPageFinished(view, url);

    protected override void Dispose(bool disposing)
    {
        if (!disposing)
            return;

        originalWebViewClient.Dispose();
    }

    private static HttpRequestMessage ConvertToHttpRequestMessage(IWebResourceRequest request, AppState appState, IHeaderService headerService)
    {
        var httpRequest = new HttpRequestMessage
        {
            Method = new HttpMethod(request.Method!),
            RequestUri = new Uri(request.Url!.ToString()!)
        };

        foreach (var (key, value) in request.RequestHeaders ?? new Dictionary<string, string>())
        {
            // Try to add headers safely (some headers like 'Host' or 'Content-Length' may not be allowed)
            if (!httpRequest.Headers.TryAddWithoutValidation(key, value))
            {
                if (string.Equals(key, "Content-Type", StringComparison.OrdinalIgnoreCase))
                {
                    httpRequest.Content ??= new StringContent(""); // Ensure content exists before setting
                    httpRequest.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(value);
                }
            }
        }

        if (appState.LoggedInUser?.Token is not null)
        {
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", appState.LoggedInUser.Token);
        }
        
        foreach (var (headerKey, value) in headerService.AppHeaders)
        {
            httpRequest.Headers.TryAddWithoutValidation(headerKey, value);
        }

        return httpRequest;
    }

    private static WebResourceResponse ConvertToWebResourceResponse(HttpResponseCacheItem httpResponseCacheItem)
    {
        return new WebResourceResponse(
            httpResponseCacheItem.ContentType,
            httpResponseCacheItem.Charset,
            httpResponseCacheItem.StatusCode,
            httpResponseCacheItem.ReasonPhrase,
            httpResponseCacheItem.Headers,
            new MemoryStream(httpResponseCacheItem.Data)
        );
    }
}
