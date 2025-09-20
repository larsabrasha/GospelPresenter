#if IOS || MACCATALYST

using System.Drawing;
using UIKit;
using WebKit;
using Microsoft.AspNetCore.Components.WebView.Maui;

namespace GospelPresenter.AppleWebInterceptor;

public class AppleBlazorWebViewHandler : BlazorWebViewHandler
{
    protected override WKWebView CreatePlatformView()
    {
        var config = base.CreatePlatformView().Configuration;

        config.SetUrlSchemeHandler(
            urlSchemeHandler: IPlatformApplication.Current!.Services.GetService<CustomSchemeHandler>(),
            urlScheme: "gf"
        );

        return new WKWebView(RectangleF.Empty, config)
        {
            BackgroundColor = UIColor.Clear,
            AutosizesSubviews = true
        };
    }
}

#endif
