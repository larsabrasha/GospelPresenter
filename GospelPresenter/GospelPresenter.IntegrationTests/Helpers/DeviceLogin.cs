using System.Net;
using System.Text.RegularExpressions;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Helpers;

/// <summary>
/// Reads a device token out of an /app-login response. The endpoint answers with a page that hands
/// the callback URL to the operating system — no HttpClient can follow a custom scheme, and a
/// redirect would leave the browser tab stranded — so the URL is taken from the fallback link the
/// page renders for the same reason.
/// </summary>
public static partial class DeviceLogin
{
    public static async Task<string> ReadTokenAsync(HttpResponseMessage response)
    {
        var callback = await ReadCallbackAsync(response);
        var fragment = callback.Fragment.TrimStart('#');
        return Uri.UnescapeDataString(fragment.Split('&')
            .Select(pair => pair.Split('=', 2))
            .Single(pair => pair[0] == "token")[1]);
    }

    public static async Task<Uri> ReadCallbackAsync(HttpResponseMessage response)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var html = await response.Content.ReadAsStringAsync();

        var match = CallbackLink().Match(html);
        match.Success.ShouldBeTrue("the /app-login page should carry the callback link");
        return new Uri(WebUtility.HtmlDecode(match.Groups["href"].Value));
    }

    [GeneratedRegex(@"id=""app-callback""\s+href=""(?<href>[^""]+)""")]
    private static partial Regex CallbackLink();
}
