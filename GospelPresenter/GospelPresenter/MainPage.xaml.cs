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
#if IOS || MACCATALYST
            handler.PlatformView.ScrollView.Bounces = false;
#endif

#if ANDROID
            handler.PlatformView.OverScrollMode = Android.Views.OverScrollMode.Never;
#endif
        });

        InitializeComponent();
        
        blazorWebView.BlazorWebViewInitialized += BlazorWebViewInitialized;
    }

    private static void BlazorWebViewInitialized(object? sender, BlazorWebViewInitializedEventArgs e) { }
}
