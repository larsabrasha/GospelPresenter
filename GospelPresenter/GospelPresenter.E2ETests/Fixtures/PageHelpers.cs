using Microsoft.Playwright;

namespace GospelPresenter.E2ETests.Fixtures;

public static class PageHelpers
{
    // crypto.randomUUID is only available in secure contexts. The app is reached over plain
    // HTTP via a docker-compose hostname, so polyfill it from crypto.getRandomValues.
    private const string CryptoRandomUuidPolyfill = """
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
            crypto.randomUUID = function () {
                const bytes = new Uint8Array(16);
                crypto.getRandomValues(bytes);
                bytes[6] = (bytes[6] & 0x0f) | 0x40;
                bytes[8] = (bytes[8] & 0x3f) | 0x80;
                const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
                return hex.slice(0,8) + '-' + hex.slice(8,12) + '-' + hex.slice(12,16) + '-' + hex.slice(16,20) + '-' + hex.slice(20);
            };
        }
        """;

    public static Task AddBrowserPolyfillsAsync(IBrowserContext context) =>
        context.AddInitScriptAsync(CryptoRandomUuidPolyfill);

    public static Task AddMockAuthCookiesAsync(IBrowserContext context, string baseUrl, string mockUserId, string lang)
    {
        var domain = new Uri(baseUrl).Host;
        return context.AddCookiesAsync(
        [
            new Cookie { Name = ".AspNetCore.Culture", Value = $"c={lang}|uic={lang}", Domain = domain, Path = "/" },
            new Cookie { Name = "mock-user-id", Value = mockUserId, Domain = domain, Path = "/" }
        ]);
    }

    public static async Task WaitForWebAppAsync(string baseUrl, int timeoutSeconds = 60, CancellationToken cancellationToken = default)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        Exception? lastError = null;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var response = await http.GetAsync(baseUrl, cancellationToken);
                if (response.IsSuccessStatusCode) return;
                lastError = new InvalidOperationException($"HTTP {(int)response.StatusCode}");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                lastError = ex;
            }
            await Task.Delay(1000, cancellationToken);
        }

        throw new TimeoutException($"Web app at {baseUrl} did not become ready within {timeoutSeconds}s. Last error: {lastError?.Message}");
    }

    public static async Task WaitForBlazorAsync(IPage page)
    {
        await page.WaitForFunctionAsync("() => document.readyState === 'complete'");
        // Brief settle for CSS transitions and Blazor circuit hookup; no reliable DOM signal.
        await page.WaitForTimeoutAsync(300);
    }

    public static async Task<string> DiscoverPresentationIdAsync(IPage page, string baseUrl)
    {
        await page.GotoAsync(baseUrl, new PageGotoOptions { WaitUntil = WaitUntilState.Load });
        await WaitForBlazorAsync(page);

        var link = page.Locator("a[href^='/presentations/']").First;
        await link.WaitForAsync(new LocatorWaitForOptions { Timeout = 10_000 });

        var href = await link.GetAttributeAsync("href")
            ?? throw new InvalidOperationException("Presentation link found but has no href attribute.");

        var path = new Uri(href, UriKind.Relative).ToString().Split('?')[0].Split('#')[0];
        return path.TrimEnd('/').Split('/').Last();
    }
}
