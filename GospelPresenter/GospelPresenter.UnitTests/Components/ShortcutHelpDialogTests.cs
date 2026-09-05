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
/// The "?" dialog. It is the only place a user finds out that any of this exists, so what it lists
/// has to be what the registry actually holds rather than a hand-kept second copy.
/// </summary>
public class ShortcutHelpDialogTests : TestContext
{
    private readonly KeyboardShortcutService shortcuts = new();

    public ShortcutHelpDialogTests()
    {
        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        JSInterop.Mode = JSRuntimeMode.Loose;

        Services.AddSingleton(shortcuts);
        Services.AddSingleton(circuit);
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    [Fact]
    public void Dialog_ListsAShortcutRegisteredByThePageBehindIt()
    {
        using var page = shortcuts.PushScope("Shortcuts.Group.Dashboard");
        page.Add(new Shortcut("n"), "Shortcuts.NewPresentation", () => { });

        RenderComponent<ShortcutHelpDialog>().Markup.ShouldContain("Ny presentation");
    }

    [Fact]
    public void Dialog_WritesTheKeystrokeTheUserPresses()
    {
        using var page = shortcuts.PushScope("Shortcuts.Group.Dashboard");
        page.Add(new Shortcut("n"), "Shortcuts.NewPresentation", () => { });

        RenderComponent<ShortcutHelpDialog>().Find("kbd").TextContent.Trim().ShouldBe("n");
    }

    /// <summary>
    /// Arrow-key movement is handled by the focused list, not by the registry, but it is still a
    /// shortcut as far as the reader is concerned.
    /// </summary>
    [Fact]
    public void Dialog_ListsDocumentedKeystrokesThatNothingDispatches()
    {
        using var page = shortcuts.PushScope("Shortcuts.Group.Dashboard");
        page.Document(new Shortcut("ArrowDown"), "Shortcuts.MoveThroughList");

        RenderComponent<ShortcutHelpDialog>().Markup.ShouldContain("Flytta i listan");
    }

    /// <summary>
    /// The dialog rebinds "?" so it can close itself, and that entry teaches the reader nothing
    /// about the page they came from.
    /// </summary>
    [Fact]
    public void Dialog_DoesNotListItsOwnCloseShortcut()
    {
        RenderComponent<ShortcutHelpDialog>().Markup.ShouldNotContain("Stäng rutan");
    }

    [Fact]
    public void Dialog_WhileOpen_SilencesThePageBehindIt()
    {
        using var page = shortcuts.PushScope("Shortcuts.Group.Dashboard");
        page.Add(new Shortcut("n"), "Shortcuts.NewPresentation", () => { });

        RenderComponent<ShortcutHelpDialog>();

        shortcuts.ActiveTokens.ShouldNotContain(new Shortcut("n").ToToken());
    }

    [Fact]
    public void Dialog_WhenDisposed_GivesThePageItsShortcutsBack()
    {
        using var page = shortcuts.PushScope("Shortcuts.Group.Dashboard");
        page.Add(new Shortcut("n"), "Shortcuts.NewPresentation", () => { });
        var dialog = RenderComponent<ShortcutHelpDialog>();

        DisposeComponents();

        shortcuts.ActiveTokens.ShouldContain(new Shortcut("n").ToToken());
    }
}
