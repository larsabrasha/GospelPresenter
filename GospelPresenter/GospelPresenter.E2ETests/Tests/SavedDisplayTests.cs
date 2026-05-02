using GospelPresenter.E2ETests.Fixtures;
using Microsoft.Playwright;
using Shouldly;

namespace GospelPresenter.E2ETests.Tests;

[Collection(PlaywrightCollection.Name)]
public class SavedDisplayTests(PlaywrightFixture fixture)
{
    // The mock-data seeder registers a saved RemoteDisplay called "Sanctuary" with this identifier.
    private const string SeededDisplayIdentifier = "sanctry";
    private const string SeededDisplayName = "Sanctuary";

    [Fact]
    public async Task SavedDisplay_GoesLiveWhenControllerEnablesIt_AndPropagatesSlide()
    {
        await using var displayContext = await fixture.NewDisplayContextAsync();
        await using var controllerContext = await fixture.NewControllerContextAsync();

        var displayPage = await displayContext.NewPageAsync();
        var controllerPage = await controllerContext.NewPageAsync();

        // Saved display opens its stable URL — the name query param is passed the same way the
        // controller's QR/copy flow constructs it, so the screen renders the display name.
        await displayPage.GotoAsync(
            $"{fixture.BaseUrl}/display?id={SeededDisplayIdentifier}&name={SeededDisplayName}",
            new PageGotoOptions { WaitUntil = WaitUntilState.Load });
        await PageHelpers.WaitForBlazorAsync(displayPage);

        // Pre-pair: the display shows its name, no pairing code is rendered.
        var preBody = await displayPage.EvaluateAsync<string>("() => document.body.textContent ?? ''");
        preBody.ShouldContain(SeededDisplayName);
        preBody.ShouldNotContain("Pairing code");

        // Controller opens a presentation and starts it.
        var presentationId = await PageHelpers.DiscoverPresentationIdAsync(controllerPage, fixture.BaseUrl);
        await controllerPage.GotoAsync($"{fixture.BaseUrl}/presentations/{presentationId}",
            new PageGotoOptions { WaitUntil = WaitUntilState.Load });
        await PageHelpers.WaitForBlazorAsync(controllerPage);

        await controllerPage.Locator("[data-id]").First.ClickAsync(new LocatorClickOptions { Timeout = 5_000 });

        var startButton = controllerPage.Locator("button[title='Start presentation']");
        if (await startButton.CountAsync() > 0)
        {
            await startButton.First.ClickAsync(new LocatorClickOptions { Force = true });
            await controllerPage.WaitForTimeoutAsync(300);
        }

        // Toggle the seeded saved display on. Using :visible drops the hidden mobile LivePanel copy.
        await controllerPage.Locator($"button:visible:has-text('{SeededDisplayName}')").First
            .ClickAsync(new LocatorClickOptions { Timeout = 5_000 });

        // Display should leave its name-only screen once the controller enables it.
        await displayPage.WaitForFunctionAsync(
            $"() => !document.body.textContent.includes('{SeededDisplayName}')",
            new PageWaitForFunctionOptions { Timeout = 5_000 });

        // Click the first slide and verify the same text reaches the saved display.
        var firstSlide = controllerPage.Locator("#main button").First;
        await firstSlide.WaitForAsync(new LocatorWaitForOptions { Timeout = 5_000 });
        var slideText = await firstSlide.InnerTextAsync();
        var probe = SlideProbe.ExtractProbe(slideText);
        probe.ShouldNotBeNullOrEmpty($"Could not extract a probe phrase from slide text: {slideText}");

        await firstSlide.ClickAsync(new LocatorClickOptions { Force = true });

        await SlideProbe.WaitForProbeOnPageAsync(displayPage, probe);
    }
}
