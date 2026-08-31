using Microsoft.AspNetCore.Components.WebView;
using Microsoft.AspNetCore.Components.WebView.Maui;
using Microsoft.Maui.Platform;

#if ANDROID
using AndroidX.Activity;
#endif

namespace GospelPresenter;

public partial class MainPage : ContentPage
{
    public MainPage()
    {
        // Remove the bounce effect when scrolling past top and bottom of the view, to behave more like an app and not a website
        // https://dev.to/mhrastegari/net-maui-blazor-best-practices-for-mobile-ui-4def
        BlazorWebViewHandler.BlazorWebViewMapper.AppendToMapping("CustomBlazorWebViewMapper", (handler, view) =>
        {
#if IOS
            handler.PlatformView.ScrollView.Bounces = false;
#endif

#if ANDROID
            handler.PlatformView.OverScrollMode = Android.Views.OverScrollMode.Never;
#endif
        });

        InitializeComponent();

        blazorWebView.BlazorWebViewInitializing += BlazorWebViewInitializing;
        blazorWebView.BlazorWebViewInitialized += BlazorWebViewInitialized;
    }

    /// <summary>
    /// Registers the gpmedia:// scheme so media renders from the local store. Must happen here:
    /// the scheme handler can only be attached to the WKWebView configuration before creation.
    /// </summary>
    private static void BlazorWebViewInitializing(object? sender, BlazorWebViewInitializingEventArgs e)
    {
#if IOS
        e.Configuration.SetUrlSchemeHandler(new Handlers.GpMediaSchemeHandler(), Handlers.GpMediaSchemeHandler.Scheme);
#endif
    }

    private static void BlazorWebViewInitialized(object? sender, BlazorWebViewInitializedEventArgs e) { }
}
