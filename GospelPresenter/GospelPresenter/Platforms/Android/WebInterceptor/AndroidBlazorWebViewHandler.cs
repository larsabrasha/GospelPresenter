using GospelPresenter.Services.Cache;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.AspNetCore.Components.WebView.Maui;
using WebView = Android.Webkit.WebView;

namespace GospelPresenter.WebInterceptor;

public class AndroidBlazorWebViewHandler: BlazorWebViewHandler
{
    protected override void ConnectHandler(WebView platformView)
    {
        base.ConnectHandler(platformView);
        
        var cacheService = IPlatformApplication.Current!.Services.GetRequiredService<ITileDataCacheService>();
        var appState = IPlatformApplication.Current!.Services.GetRequiredService<AppState>();
        var headerService = IPlatformApplication.Current!.Services.GetRequiredService<IHeaderService>();
        platformView.SetWebViewClient(new CustomWebViewClient(platformView.WebViewClient, cacheService, appState, headerService));
    }
}
