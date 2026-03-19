using Microsoft.Playwright;

namespace GospelPresenter.Screenshots;

static class BrowserHelpers
{
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

    public static async Task<string> DiscoverPresentationIdAsync(IBrowser browser, string baseUrl, string domain)
    {
        await using var context = await browser.NewContextAsync();

        // Set culture cookie so the page loads correctly even if auth depends on it
        await context.AddCookiesAsync(
        [
            new Cookie
            {
                Name = ".AspNetCore.Culture",
                Value = "c=en|uic=en",
                Domain = domain,
                Path = "/"
            }
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
