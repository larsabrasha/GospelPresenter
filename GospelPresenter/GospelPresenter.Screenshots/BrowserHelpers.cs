using Microsoft.Playwright;

namespace GospelPresenter.Screenshots;

static class BrowserHelpers
{
    // Polyfill crypto.randomUUID so it works when the page is served over plain HTTP
    // (e.g. the app reached via a docker-compose service hostname instead of localhost).
    // Browsers only expose crypto.randomUUID in secure contexts; crypto.getRandomValues
    // is available everywhere and is sufficient for a v4 UUID.
    const string CryptoRandomUuidPolyfill = """
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

    public static async Task WaitForWebAppAsync(string baseUrl, int timeoutSeconds = 60,
        CancellationToken cancellationToken = default)
    {
        Console.Write("Waiting for web app to be ready... ");
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        var attempts = 0;
        string? lastError = null;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            attempts++;

            try
            {
                var response = await http.GetAsync(baseUrl, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    Console.WriteLine("ready");
                    return;
                }

                lastError = $"HTTP {(int)response.StatusCode}";
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                lastError = $"{ex.GetType().Name}: {ex.Message}";
            }

            // Log only every 10th attempt to avoid noise
            if (attempts % 10 == 0)
            {
                Console.Write($"\n  still waiting ({lastError})... ");
            }

            await Task.Delay(1000, cancellationToken);
        }

        throw new TimeoutException($"Web app at {baseUrl} did not become ready within {timeoutSeconds}s. Last error: {lastError}");
    }

    public static async Task WaitForBlazorAsync(IPage page)
    {
        // Wait for Blazor Server circuit to connect and finish rendering
        await page.WaitForFunctionAsync("() => document.readyState === 'complete'");

        // Fixed delay to let CSS transitions, lazy-loaded images, and responsive layout
        // settle after viewport changes. No reliable DOM signal exists for these.
        await page.WaitForTimeoutAsync(500);
    }

    public static async Task<string> DiscoverPresentationIdAsync(IBrowser browser, string baseUrl, string domain, string lang = "en")
    {
        await using var context = await browser.NewContextAsync();
        await AddBrowserPolyfillsAsync(context);

        var mockUserId = lang == "sv" ? "mock-user-sv" : "mock-user-en";
        await context.AddCookiesAsync(
        [
            new Cookie { Name = ".AspNetCore.Culture", Value = $"c={lang}|uic={lang}", Domain = domain, Path = "/" },
            new Cookie { Name = "mock-user-id", Value = mockUserId, Domain = domain, Path = "/" }
        ]);

        var page = await context.NewPageAsync();

        // Navigate once to establish the auth cookie (mock mode auto-signs in)
        await page.GotoAsync(baseUrl, new PageGotoOptions { WaitUntil = WaitUntilState.Load });

        // Wait for the presentation link to appear in the DOM.
        // This requires the app to be running in mock mode (auto-signs in).
        // If auth is required, this will time out on the login page.
        var link = page.Locator("a[href^='/presentations/']").First;
        try
        {
            await link.WaitForAsync(new LocatorWaitForOptions { Timeout = 10_000 });
        }
        catch (TimeoutException)
        {
            throw new InvalidOperationException(
                "Could not find a presentation link on the home page. " +
                "Make sure the app is running in mock mode (auto-sign-in) and has at least one presentation.");
        }

        var href = await link.GetAttributeAsync("href")
            ?? throw new InvalidOperationException("Presentation link found but has no href attribute.");

        await page.CloseAsync();

        // href is like "/presentations/{guid}" — strip query/fragment before extracting the ID
        var path = new Uri(href, UriKind.Relative).ToString().Split('?')[0].Split('#')[0];
        return path.TrimEnd('/').Split('/').Last();
    }
}
