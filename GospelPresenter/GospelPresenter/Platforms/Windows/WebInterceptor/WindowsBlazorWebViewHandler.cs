using Microsoft.Web.WebView2.Core;
using Microsoft.UI.Xaml.Controls;
using GospelPresenter.Services.Cache;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Components.WebView.Maui;
using Serilog;
using HttpMethod = System.Net.Http.HttpMethod;
using HttpRequestMessage = System.Net.Http.HttpRequestMessage;

namespace GospelPresenter.WebInterceptor;

public class WindowsBlazorWebViewHandler : BlazorWebViewHandler
{
    private const string PlaceholderTileServiceBaseAddressFilter = "https://a.tile.openstreetmap.org/*";

    protected override void ConnectHandler(WebView2 platformView)
    {
        base.ConnectHandler(platformView);

        platformView.CoreWebView2Initialized += PlatformView_CoreWebView2Initialized;
    }

    protected override void DisconnectHandler(WebView2 platformView)
    {
        platformView.CoreWebView2Initialized -= PlatformView_CoreWebView2Initialized;

        if (platformView.CoreWebView2 is not null)
        {
            platformView.CoreWebView2.WebResourceRequested -= CoreWebView2_WebResourceRequested;
        }

        base.DisconnectHandler(platformView);
    }

    private static void PlatformView_CoreWebView2Initialized(WebView2 sender, CoreWebView2InitializedEventArgs e)
    {
        var coreWebView2 = sender.CoreWebView2;
        if (coreWebView2 is null) return;

        Log.Debug("WebView2 data folder: {DataFolder}", coreWebView2.Environment.UserDataFolder);

        // Only intercepting certain requests
        coreWebView2.AddWebResourceRequestedFilter(PlaceholderTileServiceBaseAddressFilter, CoreWebView2WebResourceContext.All);
        
        coreWebView2.WebResourceRequested += CoreWebView2_WebResourceRequested;
    }

    private static async void CoreWebView2_WebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        // Ignoring some required requests
        if (e.Request.Uri.StartsWith("https://0.0.0.1/", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        // Calling GetDeferral() creates a deferral object. This tells WebView2 to pause the web resource request and
        // wait for the code to complete its asynchronous task. After the asynchronous operation is finished, and we have set the response,
        // we call Complete() on the deferral object to signal to WebView2 that the deferral is over and the request can proceed.
        var deferral = e.GetDeferral();

        var platformApplication = IPlatformApplication.Current!;
        var cacheService = platformApplication.Services.GetRequiredService<ITileDataCacheService>();
        var headerService = platformApplication.Services.GetRequiredService<IHeaderService>();
        
        var request = ConvertToHttpRequestMessage(e.Request, headerService);
        var httpResponseCacheItem = await cacheService.GetOrSetTileAsync(request.RequestUri!.ToString(), request);
        var memoryStream = new MemoryStream(httpResponseCacheItem.Data);
        var asRandomAccessStream = memoryStream.AsRandomAccessStream();
        
        e.Response = (sender as CoreWebView2)!.Environment.CreateWebResourceResponse(
            asRandomAccessStream,
            httpResponseCacheItem.StatusCode,
            httpResponseCacheItem.ReasonPhrase,
            string.Join("\n", httpResponseCacheItem.Headers.Select(x => $"{x.Key}:{x.Value}"))
        );
        
        deferral.Complete();
    }

    private static HttpRequestMessage ConvertToHttpRequestMessage(CoreWebView2WebResourceRequest request, IHeaderService headerService)
    {
        var httpRequest = new HttpRequestMessage
        {
            Method = new HttpMethod(request.Method!),
            RequestUri = new Uri(request.Uri)
        };

        foreach (var (key, value) in request.Headers)
        {
            httpRequest.Headers.TryAddWithoutValidation(key, value);
        }

        foreach (var (headerKey, value) in headerService.AppHeaders)
        {
            httpRequest.Headers.TryAddWithoutValidation(headerKey, value);
        }
        
        // if (appState.LoggedInUser?.Token is not null)
        // {
        //     httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", appState.LoggedInUser.Token);
        // }

        return httpRequest;
    }
}
