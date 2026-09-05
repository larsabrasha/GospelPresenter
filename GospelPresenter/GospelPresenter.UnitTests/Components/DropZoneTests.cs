using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Components;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The drop zone around an upload. Everything that reads a dropped file lives in JavaScript, so
/// what is testable here is the contract with it: the zone registers itself, the browser gets an
/// overlay to toggle, and a drop the input cannot use is reported back to the user.
/// </summary>
public class DropZoneTests : TestContext
{
    private readonly ToastService toasts = new();

    public DropZoneTests()
    {
        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        // The zone reaches for the browser on first render; nothing here depends on the answer.
        JSInterop.Mode = JSRuntimeMode.Loose;

        Services.AddSingleton(circuit);
        Services.AddSingleton(toasts);
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    [Fact]
    public void DropZone_RegistersItselfWithTheBrowser()
    {
        RenderComponent<DropZone>();

        JSInterop.VerifyInvoke("gospelPresenter.registerDropZone");
    }

    /// <summary>
    /// The order of these arguments is the contract with the JavaScript half, which reads them by
    /// position: the element, the selector for the input to feed, the accept list and whether more
    /// than one file may land where there is no input, whether .NET will take the files instead,
    /// and the reference it calls back on.
    /// </summary>
    [Fact]
    public void DropZone_TellsTheBrowserWhatItAcceptsAndWhereADropGoes()
    {
        RenderComponent<DropZone>(p => p
            .Add(z => z.InputSelector, "#logo-input")
            .Add(z => z.Accept, "image/png")
            .Add(z => z.Multiple, false)
            .Add(z => z.OnFilesDropped, _ => { }));

        var arguments = JSInterop.VerifyInvoke("gospelPresenter.registerDropZone").Arguments;

        arguments[1].ShouldBe("#logo-input");
        arguments[2].ShouldBe("image/png");
        arguments[3].ShouldBe(false);
        arguments[4].ShouldBe(true);
    }

    /// <summary>Without somewhere to hand files, the browser must keep feeding the input.</summary>
    [Fact]
    public void DropZone_WithNoDropHandler_DoesNotOfferToTakeTheFiles()
    {
        RenderComponent<DropZone>();

        JSInterop.VerifyInvoke("gospelPresenter.registerDropZone").Arguments[4].ShouldBe(false);
    }

    [Fact]
    public void DropZone_KeepsTheHintHiddenUntilFilesHoverOverIt()
    {
        var zone = RenderComponent<DropZone>();

        zone.Find("[data-dropzone-overlay]").ClassList.ShouldContain("hidden");
    }

    /// <summary>The overlay must not swallow the drop it is drawn on top of.</summary>
    [Fact]
    public void DropZone_LetsTheHintPassPointerEventsThrough()
    {
        var zone = RenderComponent<DropZone>();

        zone.Find("[data-dropzone-overlay]").ClassList.ShouldContain("pointer-events-none");
    }

    [Fact]
    public void DropZone_MarksItselfSoAStrayDropElsewhereCanBeToldApart()
    {
        var zone = RenderComponent<DropZone>();

        zone.Find("div").HasAttribute("data-dropzone").ShouldBeTrue();
    }

    [Fact]
    public void DropZone_KeepsTheClassesItWasGivenAndAddsThePositioningItNeeds()
    {
        var zone = RenderComponent<DropZone>(p => p.Add(z => z.Class, "flex flex-col h-full"));

        zone.Find("[data-dropzone]").ClassList.ShouldBe(
            ["relative", "flex", "flex-col", "h-full"], ignoreOrder: true);
    }

    [Fact]
    public void DropZone_WithoutALabel_HintsInTheUserSLanguage()
    {
        var zone = RenderComponent<DropZone>();

        zone.Find("[data-dropzone-overlay] span").TextContent.ShouldBe("Släpp filerna här");
    }

    [Fact]
    public void DropZone_WithALabel_HintsAtWhatBelongsInThisZone()
    {
        var zone = RenderComponent<DropZone>(p => p.Add(z => z.Label, "Släpp bilder här"));

        zone.Find("[data-dropzone-overlay] span").TextContent.ShouldBe("Släpp bilder här");
    }

    [Fact]
    public void DropZone_Compact_LeavesOutTheIconThatWouldNotFit()
    {
        var zone = RenderComponent<DropZone>(p => p.Add(z => z.Compact, true));

        zone.FindAll("[data-dropzone-overlay] svg").ShouldBeEmpty();
    }

    [Fact]
    public void OnFilesRejected_TellsTheUserTheFileTypeCannotBeUsed()
    {
        var messages = new List<string>();
        toasts.OnShow += (message, _) => messages.Add(message);
        var zone = RenderComponent<DropZone>();

        zone.Instance.OnFilesRejected();

        messages.ShouldBe(["Den filtypen kan inte användas här"]);
    }

    /// <summary>A green tick on a drop that uploaded nothing would say the opposite of the truth.</summary>
    [Fact]
    public void OnFilesRejected_WarnsRatherThanConfirms()
    {
        var kinds = new List<ToastKind>();
        toasts.OnShow += (_, kind) => kinds.Add(kind);
        var zone = RenderComponent<DropZone>();

        zone.Instance.OnFilesRejected();

        kinds.ShouldBe([ToastKind.Warning]);
    }

    [Fact]
    public async Task OnBrowserDrop_HandsOnEveryFileTheBrowserKept()
    {
        IReadOnlyList<DroppedFile>? dropped = null;
        var zone = RenderComponent<DropZone>(p => p.Add(z => z.OnFilesDropped, files => dropped = files));

        await zone.Instance.OnBrowserDrop(["psalm.png", "vers.png"]);

        dropped!.Select(file => file.FileName).ShouldBe(["psalm.png", "vers.png"]);
    }

    /// <summary>
    /// The browser holds the files until .NET has read them. Leaving them held would keep whatever
    /// was dropped alive for as long as the page stays open.
    /// </summary>
    [Fact]
    public async Task OnBrowserDrop_LetsTheBrowserGoOfTheFilesAfterwards()
    {
        var zone = RenderComponent<DropZone>(p => p.Add(z => z.OnFilesDropped, _ => { }));

        await zone.Instance.OnBrowserDrop(["psalm.png"]);

        JSInterop.VerifyInvoke("gospelPresenter.releaseDroppedFiles");
    }

    [Fact]
    public async Task OnBrowserDrop_LetsGoEvenWhenTheUploadThrows()
    {
        var zone = RenderComponent<DropZone>(p => p.Add(z => z.OnFilesDropped,
            _ => throw new InvalidOperationException("the ingest gave up")));

        await Should.ThrowAsync<InvalidOperationException>(() => zone.Instance.OnBrowserDrop(["psalm.png"]));

        JSInterop.VerifyInvoke("gospelPresenter.releaseDroppedFiles");
    }

    [Fact]
    public void DropZone_RendersWhatItWraps()
    {
        var zone = RenderComponent<DropZone>(p => p.AddChildContent("<input type=\"file\"/>"));

        zone.FindAll("input[type=\"file\"]").Count.ShouldBe(1);
    }
}
