namespace GospelPresenter.Services;

public static class WebViewUtil
{
    public static int? GetMajorVersion()
    {
        var webView = new Android.Webkit.WebView(Android.App.Application.Context);
        var userAgent = webView.Settings.UserAgentString;
        var chromeVersion = ParseChromeVersion(userAgent);
        
        return int.TryParse(chromeVersion.Split(".").FirstOrDefault(), out var majorVersion)
            ? majorVersion
            : null;
    }
    
    private static string ParseChromeVersion(string? userAgent)
    {
        var startIndex = userAgent?.IndexOf("Chrome/") ?? -1;
        if (startIndex == -1 || userAgent is null)
        {
            return string.Empty;
        }
        
        startIndex += "Chrome/".Length;
        
        var endIndex = userAgent.IndexOf(' ', startIndex);
        if (endIndex != -1)
        {
            return userAgent.Substring(startIndex, endIndex - startIndex);
        }

        return string.Empty;
    }
}
