using Microsoft.Playwright;

namespace GospelPresenter.E2ETests.Fixtures;

// Owns the Playwright runtime and a single browser for the whole test run.
// Tests should request a fresh IBrowserContext per scenario via NewControllerContextAsync /
// NewDisplayContextAsync to keep cookies and storage isolated.
public class PlaywrightFixture : IAsyncLifetime
{
    public string BaseUrl { get; private set; } = "";
    public IPlaywright Playwright { get; private set; } = null!;
    public IBrowser Browser { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        BaseUrl = (Environment.GetEnvironmentVariable("E2E_BASE_URL") ?? "http://localhost:8080").TrimEnd('/');

        await PageHelpers.WaitForWebAppAsync(BaseUrl);

        Playwright = await Microsoft.Playwright.Playwright.CreateAsync();
        Browser = await Playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = !string.Equals(Environment.GetEnvironmentVariable("E2E_HEADED"), "true", StringComparison.OrdinalIgnoreCase),
            // Treat the base URL as a secure context so browser APIs like crypto.randomUUID
            // work over plain HTTP (e.g. when the app is reached via a docker-compose hostname).
            Args = [$"--unsafely-treat-insecure-origin-as-secure={BaseUrl}"]
        });
    }

    public async Task DisposeAsync()
    {
        if (Browser is not null) await Browser.DisposeAsync();
        Playwright?.Dispose();
    }

    public async Task<IBrowserContext> NewControllerContextAsync(string mockUserId = "mock-user-en", string lang = "en")
    {
        var context = await Browser.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = 1440, Height = 900 }
        });
        await PageHelpers.AddBrowserPolyfillsAsync(context);
        await PageHelpers.AddMockAuthCookiesAsync(context, BaseUrl, mockUserId, lang);
        return context;
    }

    public async Task<IBrowserContext> NewDisplayContextAsync()
    {
        var context = await Browser.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = 1280, Height = 720 }
        });
        await PageHelpers.AddBrowserPolyfillsAsync(context);
        return context;
    }
}

[CollectionDefinition(Name)]
public class PlaywrightCollection : ICollectionFixture<PlaywrightFixture>
{
    public const string Name = "Playwright";
}
