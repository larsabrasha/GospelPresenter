using Microsoft.AspNetCore.Components.WebView;
using Microsoft.AspNetCore.Components.WebView.Maui;

namespace GospelPresenter;

/// <summary>
/// The projector window's content: a second BlazorWebView straight onto /live. Operator and
/// projector couple exactly as two browser windows do on the web — SharedAppState is a process
/// singleton and both webviews hang off the same service provider — while scoped state (the
/// viewport) stays per webview, which is what /live expects.
/// </summary>
public class LivePage : ContentPage
{
    public LivePage(string sessionId, string windowId, string title)
    {
        Title = title;
        BackgroundColor = Colors.Black;

        var webView = new BlazorWebView
        {
            HostPage = "wwwroot/index.html",
            StartPath = $"/live?session={Uri.EscapeDataString(sessionId)}"
                        + $"&windowId={Uri.EscapeDataString(windowId)}"
                        + $"&title={Uri.EscapeDataString(title)}",
        };
        webView.RootComponents.Add(new RootComponent { Selector = "#app", ComponentType = typeof(Shared.Routes) });
        webView.BlazorWebViewInitializing += OnInitializing;

        Content = webView;
    }

    /// <summary>The projector shows media too: this webview needs the gpmedia scheme as well.</summary>
    private static void OnInitializing(object? sender, BlazorWebViewInitializingEventArgs e)
    {
#if IOS || MACCATALYST
        e.Configuration.SetUrlSchemeHandler(new Handlers.GpMediaSchemeHandler(), Handlers.GpMediaSchemeHandler.Scheme);
#endif
    }
}
