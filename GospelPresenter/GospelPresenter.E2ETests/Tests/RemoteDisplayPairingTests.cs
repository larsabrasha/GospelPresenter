using System.Text.RegularExpressions;
using GospelPresenter.E2ETests.Fixtures;
using Microsoft.Playwright;
using Shouldly;

namespace GospelPresenter.E2ETests.Tests;

[Collection(PlaywrightCollection.Name)]
public class RemoteDisplayPairingTests(PlaywrightFixture fixture)
{
    [Fact]
    public async Task AdHocDisplay_PairsWithControllerViaCode_AndReportsSuccess()
    {
        await using var session = await PairAdHocDisplayAsync();

        // The dialog flips to its success state once pairing succeeds.
        await session.Controller
            .GetByText("Display connected").Or(session.Controller.GetByText("Skärmen är ansluten"))
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 5_000 });

        // The display device leaves the pairing-code screen — the code is no longer in the DOM.
        await session.Display.WaitForFunctionAsync(
            "() => !document.body.textContent.includes('Pairing code') && !document.body.textContent.includes('Parkopplingskod')",
            new PageWaitForFunctionOptions { Timeout = 5_000 });
    }

    [Fact]
    public async Task LiveSlideChanges_PropagateFromControllerToDisplay()
    {
        await using var session = await PairAdHocDisplayAsync();

        // Close the success dialog so we can interact with the slide list underneath.
        await session.Controller.GetByRole(AriaRole.Button, new() { Name = "Close" })
            .ClickAsync(new LocatorClickOptions { Timeout = 5_000 });

        // Capture the text from the first slide preview, then click it to make it the live slide.
        var firstSlide = session.Controller.Locator("#main button").First;
        await firstSlide.WaitForAsync(new LocatorWaitForOptions { Timeout = 5_000 });
        var slideText = await firstSlide.InnerTextAsync();

        var probe = SlideProbe.ExtractProbe(slideText);
        probe.ShouldNotBeNullOrEmpty($"Could not extract a probe phrase from slide text: {slideText}");

        await firstSlide.ClickAsync(new LocatorClickOptions { Force = true });

        // Wait for the same text to appear on the paired display, confirming SignalR propagation.
        await SlideProbe.WaitForProbeOnPageAsync(session.Display, probe);
    }

    [Fact]
    public async Task AdHocDisplay_SurvivesPageReload()
    {
        await using var session = await PairAdHocDisplayAsync();

        // Wait for the success state on the controller so we know pairing is fully committed.
        await session.Controller
            .GetByText("Display connected").Or(session.Controller.GetByText("Skärmen är ansluten"))
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 5_000 });

        // Reload the display page. sessionStorage keeps the ad-hoc displayId, so the server-side
        // pairing should still match and the display should not fall back to a fresh code.
        await session.Display.ReloadAsync(new PageReloadOptions { WaitUntil = WaitUntilState.Load });
        await PageHelpers.WaitForBlazorAsync(session.Display);

        await session.Display.WaitForFunctionAsync(
            "() => !document.body.textContent.includes('Pairing code') && !document.body.textContent.includes('Parkopplingskod')",
            new PageWaitForFunctionOptions { Timeout = 5_000 });
    }

    [Fact]
    public async Task ControllerDisconnect_RevertsAdHocDisplayToPairingCode()
    {
        await using var session = await PairAdHocDisplayAsync();

        // Close the pairing-success dialog to expose the LivePanel that lists connected displays.
        await session.Controller.GetByRole(AriaRole.Button, new() { Name = "Close" })
            .ClickAsync(new LocatorClickOptions { Timeout = 5_000 });

        // Click the disconnect button next to the connected ad-hoc display row.
        // The page renders both a mobile and a desktop LivePanel — :visible skips the one
        // hidden via Tailwind's responsive utilities so .First lands on the active panel.
        await session.Controller.Locator("button[title='Disconnect']:visible").First
            .ClickAsync(new LocatorClickOptions { Timeout = 5_000 });

        // The display should fall back to a fresh 4-digit pairing code.
        await session.Display.WaitForFunctionAsync(
            "() => /\\b\\d{4}\\b/.test(document.body.textContent) && (document.body.textContent.includes('Pairing code') || document.body.textContent.includes('Parkopplingskod'))",
            new PageWaitForFunctionOptions { Timeout = 5_000 });
    }

    private async Task<PairedSession> PairAdHocDisplayAsync()
    {
        var displayContext = await fixture.NewDisplayContextAsync();
        var controllerContext = await fixture.NewControllerContextAsync();

        var displayPage = await displayContext.NewPageAsync();
        var controllerPage = await controllerContext.NewPageAsync();

        // Display device opens /display and shows a 4-digit pairing code.
        await displayPage.GotoAsync($"{fixture.BaseUrl}/display", new PageGotoOptions { WaitUntil = WaitUntilState.Load });
        await PageHelpers.WaitForBlazorAsync(displayPage);

        var pairingCode = await ReadPairingCodeAsync(displayPage);
        pairingCode.ShouldMatch(@"^\d{4}$");

        // Controller opens a presentation, starts it, and opens the pairing dialog.
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

        await controllerPage.GetByRole(AriaRole.Button, new() { Name = "Add output" })
            .ClickAsync(new LocatorClickOptions { Timeout = 5_000 });
        await controllerPage.GetByRole(AriaRole.Button, new() { Name = "Temporary display" })
            .ClickAsync(new LocatorClickOptions { Timeout = 5_000 });

        // Type the 4 digits into the pairing dialog.
        var digitInputs = controllerPage.Locator("input[maxlength='1'][inputmode='numeric']");
        await digitInputs.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 5_000 });
        for (var i = 0; i < 4; i++)
        {
            await digitInputs.Nth(i).FillAsync(pairingCode[i].ToString());
        }

        return new PairedSession(controllerContext, displayContext, controllerPage, displayPage);
    }

    private static async Task<string> ReadPairingCodeAsync(IPage displayPage)
    {
        // Use textContent rather than innerText — innerText depends on rendered layout
        // and can return empty when the display chrome briefly collapses during re-renders.
        var bodyText = await displayPage.EvaluateAsync<string>("() => document.body.textContent ?? ''");
        var match = Regex.Match(bodyText, @"\b(\d{4})\b");
        match.Success.ShouldBeTrue($"Expected a 4-digit pairing code on /display, body was: {bodyText}");
        return match.Groups[1].Value;
    }

    private sealed record PairedSession(
        IBrowserContext ControllerContext,
        IBrowserContext DisplayContext,
        IPage Controller,
        IPage Display) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            await ControllerContext.DisposeAsync();
            await DisplayContext.DisposeAsync();
        }
    }
}
