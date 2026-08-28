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

        blazorWebView.BlazorWebViewInitializing += BlazorWebViewInitializing;
        blazorWebView.BlazorWebViewInitialized += BlazorWebViewInitialized;

#if MACCATALYST
        BuildDisplayMenu();
#endif
    }

#if MACCATALYST
    /// <summary>
    /// The safety net when the automatic external-screen placement guesses wrong: a menu item
    /// that re-sends the most recent live window to the external screen.
    /// </summary>
    private void BuildDisplayMenu()
    {
        var services = IPlatformApplication.Current?.Services;
        var localizer = services?.GetService<Microsoft.Extensions.Localization.IStringLocalizer<Shared.Localization.SharedResource>>();

        var moveItem = new MenuFlyoutItem { Text = localizer?["LiveWindow.MoveToExternal"] ?? "Show live view on the external screen" };
        moveItem.Clicked += async (_, _) =>
        {
            if (IPlatformApplication.Current?.Services.GetService<Shared.Services.ILiveWindowLauncher>()
                is Services.MauiLiveWindowLauncher launcher)
            {
                await launcher.MoveLatestToExternalAsync();
            }
        };

        var menu = new MenuBarItem { Text = localizer?["LiveWindow.Menu"] ?? "Display" };
        menu.Add(moveItem);
        MenuBarItems.Add(menu);
    }
#endif

    /// <summary>
    /// Registers the gpmedia:// scheme so media renders from the local store. Must happen here:
    /// the scheme handler can only be attached to the WKWebView configuration before creation.
    /// </summary>
    private static void BlazorWebViewInitializing(object? sender, BlazorWebViewInitializingEventArgs e)
    {
#if IOS || MACCATALYST
        e.Configuration.SetUrlSchemeHandler(new Handlers.GpMediaSchemeHandler(), Handlers.GpMediaSchemeHandler.Scheme);
#endif
    }

    private static void BlazorWebViewInitialized(object? sender, BlazorWebViewInitializedEventArgs e) { }
}
