using Microsoft.Playwright;

namespace GospelPresenter.Screenshots;

class ScreenshotCapturer(Options options, CancellationToken cancellationToken)
{
    static readonly string[] Languages = ["en", "sv"];
    static readonly string[] Themes = ["light", "dark"];

    static readonly (string Name, int Width, int Height)[] Viewports =
    [
        ("desktop", 1440, 900),
        ("tablet", 820, 1180),
        ("mobile", 390, 844)
    ];

    // Pages to capture. Use "{presentationId}" as a placeholder — it will be resolved at runtime.
    static readonly (string Name, string Path)[] Pages =
    [
        ("home", "/"),
        ("presentation", "/presentations/{presentationId}"),
        ("songs", "/admin/songs"),
        ("settings", "/settings"),
        ("live", "/live")
    ];

    public async Task<int> RunAsync()
    {
        Directory.CreateDirectory(options.Output);

        Console.WriteLine($"Base URL: {options.BaseUrl}");
        Console.WriteLine($"Output:   {options.Output}");
        Console.WriteLine();

        if (options.Install)
        {
            return InstallBrowsers();
        }

        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = !options.Headed
        });

        await BrowserHelpers.WaitForWebAppAsync(options.BaseUrl, cancellationToken: cancellationToken);

        var domain = new Uri(options.BaseUrl).Host;
        var presentationId = await BrowserHelpers.DiscoverPresentationIdAsync(browser, options.BaseUrl, domain);
        Console.WriteLine($"Discovered presentation ID: {presentationId}");
        Console.WriteLine();

        var failures = await CaptureAllAsync(browser, domain, presentationId, cancellationToken);

        return failures.Count > 0 ? 1 : 0;
    }

    static int InstallBrowsers()
    {
        var exitCode = Microsoft.Playwright.Program.Main(["install", "chromium"]);
        if (exitCode != 0)
        {
            Console.Error.WriteLine("Failed to install Playwright browsers.");
            return 1;
        }

        Console.WriteLine("Playwright browsers installed successfully.");
        return 0;
    }

    async Task<List<(string FileName, string Error)>> CaptureAllAsync(
        IBrowser browser, string domain, string presentationId, CancellationToken ct)
    {
        var total = Pages.Length * Languages.Length * Themes.Length * Viewports.Length;
        var completed = new int[] { 0 };
        var screenshotFailures = new List<(string FileName, string Error)>();
        var setupWarnings = new List<(string Context, string Warning)>();
        var lockObj = new object();

        var baseUri = new Uri(options.BaseUrl.TrimEnd('/') + "/");

        var combinations =
            from lang in Languages
            from theme in Themes
            select (lang, theme);

        await Parallel.ForEachAsync(combinations,
            new ParallelOptions { MaxDegreeOfParallelism = options.Parallel, CancellationToken = ct },
            async (combo, token) =>
            {
                await CaptureContextAsync(
                    browser, domain, presentationId, baseUri,
                    combo.lang, combo.theme, total,
                    screenshotFailures, setupWarnings, lockObj, completed, token);
            });

        Console.WriteLine();
        Console.WriteLine($"Captured {completed[0] - screenshotFailures.Count}/{completed[0]} screenshots in {Path.GetFullPath(options.Output)}");

        var allIssues = setupWarnings
            .Select(w => (w.Context, w.Warning))
            .Concat(screenshotFailures.Select(f => (f.FileName, f.Error)))
            .ToList();

        if (allIssues.Count > 0)
        {
            Console.WriteLine();
            Console.Error.WriteLine($"{allIssues.Count} issue(s):");
            foreach (var (name, error) in allIssues)
            {
                Console.Error.WriteLine($"  {name}: {error}");
            }
        }

        return screenshotFailures;
    }

    async Task CaptureContextAsync(
        IBrowser browser, string domain, string presentationId, Uri baseUri,
        string lang, string theme, int total,
        List<(string FileName, string Error)> screenshotFailures,
        List<(string Context, string Warning)> setupWarnings,
        object lockObj, int[] completed, CancellationToken ct)
    {
        IBrowserContext context;
        try
        {
            context = await browser.NewContextAsync(new BrowserNewContextOptions
            {
                ViewportSize = new ViewportSize { Width = Viewports[0].Width, Height = Viewports[0].Height },
                DeviceScaleFactor = 2
            });
        }
        catch (Exception ex)
        {
            var skipped = Pages.Length * Viewports.Length;
            lock (lockObj)
            {
                completed[0] += skipped;
                setupWarnings.Add(($"context_{lang}_{theme}", ex.Message));
            }
            Console.Error.WriteLine($"Failed to create browser context (lang={lang}, theme={theme}): {ex.Message} — skipping {skipped} screenshots");
            return;
        }

        await using (context)
        {
            var browserPage = await SetupContextAsync(context, domain, lang, theme, setupWarnings, lockObj);

            foreach (var page in Pages)
            {
                var path = page.Path.Replace("{presentationId}", presentationId);
                var url = new Uri(baseUri, path.TrimStart('/')).ToString();

                foreach (var viewport in Viewports)
                {
                    ct.ThrowIfCancellationRequested();

                    var fileName = $"{page.Name}_{lang}_{theme}_{viewport.Name}.png";
                    var filePath = Path.Combine(options.Output, fileName);

                    int current;
                    lock (lockObj) { current = ++completed[0]; }

                    Console.Write($"[{current}/{total}] {fileName} ... ");

                    try
                    {
                        await TakeScreenshotAsync(browserPage, url, viewport, filePath);
                        Console.WriteLine("done");
                    }
                    catch (Exception firstEx)
                    {
                        Console.Write($"failed ({firstEx.Message}), retrying... ");

                        try
                        {
                            await TakeScreenshotAsync(browserPage, url, viewport, filePath);
                            Console.WriteLine("done (retry)");
                        }
                        catch (Exception retryEx)
                        {
                            Console.WriteLine($"FAILED: {retryEx.Message}");
                            lock (lockObj) { screenshotFailures.Add((fileName, retryEx.Message)); }
                        }
                    }
                }
            }
        }
    }

    async Task<IPage> SetupContextAsync(IBrowserContext context, string domain, string lang, string theme,
        List<(string Context, string Warning)> setupWarnings, object lockObj)
    {
        await context.AddCookiesAsync(
        [
            new Cookie
            {
                Name = ".AspNetCore.Culture",
                Value = $"c={lang}|uic={lang}",
                Domain = domain,
                Path = "/"
            }
        ]);

        var page = await context.NewPageAsync();
        await page.AddInitScriptAsync($"localStorage.setItem('theme', '{theme}')");

        Console.WriteLine($"Setting up context: lang={lang}, theme={theme}");

        // Navigate once to establish the auth cookie (mock mode auto-signs in)
        await page.GotoAsync(options.BaseUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load
        });

        // Verify the theme is applied before capturing any screenshots.
        // The app only adds a "dark" class — light mode has no class on <html>.
        var themeCheck = theme == "dark"
            ? "() => document.documentElement.classList.contains('dark')"
            : "() => !document.documentElement.classList.contains('dark')";
        try
        {
            await page.WaitForFunctionAsync(themeCheck,
                new PageWaitForFunctionOptions { Timeout = 3_000 });
        }
        catch (TimeoutException)
        {
            var warning = $"Theme '{theme}' not applied after 3s, continuing anyway";
            Console.WriteLine($"WARNING: {warning}");
            lock (lockObj) { setupWarnings.Add(($"theme_{lang}_{theme}", warning)); }
        }

        return page;
    }

    static async Task TakeScreenshotAsync(
        IPage page, string url, (string Name, int Width, int Height) viewport, string filePath)
    {
        await page.SetViewportSizeAsync(viewport.Width, viewport.Height);

        await page.GotoAsync(url, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load
        });

        await BrowserHelpers.WaitForBlazorAsync(page);

        await page.ScreenshotAsync(new PageScreenshotOptions
        {
            Path = filePath,
            FullPage = false
        });
    }
}
