using Bunit;
using GospelPresenter.Shared.Components;
using GospelPresenter.Shared.Localization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The container that forwards only the keys its owner reacts to.
///
/// The add-item tabs listen for their shortcuts on the container rather than on the search field,
/// so <c>Cmd+Enter</c> still works after clicking a verse in the results — but keydown bubbles,
/// so every keystroke typed into the field used to travel to the server to match no shortcut at
/// all. The filtering happens in JavaScript, which cannot be exercised here; what can is the list
/// of keys crossing the boundary, and that the modifiers survive the trip back.
/// </summary>
public class KeyFilterTests : TestContext
{
    public KeyFilterTests()
    {
        JSInterop.Mode = JSRuntimeMode.Loose;
        Services.AddLogging();
        Services.AddLocalization();
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new Microsoft.Extensions.Options.OptionsWrapper<LocalizationOptions>(new LocalizationOptions()),
                    NullLoggerFactory.Instance)));
    }

    private IRenderedComponent<KeyFilter> RenderFilter(
        string[] keys, Action<FilteredKey>? onKey = null) =>
        RenderComponent<KeyFilter>(parameters => parameters
            .Add(p => p.Keys, keys)
            .Add(p => p.OnKey, onKey ?? (_ => { })));

    [Fact]
    public void ForwardsOnlyTheKeysItWasGiven()
    {
        RenderFilter(["Enter", "ArrowUp", "ArrowDown"]);

        var calls = JSInterop.Invocations["initKeyFilter"];
        calls.Count.ShouldBe(1);
        calls[0].Arguments[2].ShouldBe(new[] { "Enter", "ArrowUp", "ArrowDown" });
    }

    [Fact]
    public void InstallsNothingWhenThereAreNoKeys()
    {
        RenderFilter([]);

        JSInterop.Invocations["initKeyFilter"].ShouldBeEmpty();
    }

    [Fact]
    public async Task CarriesTheModifiersBack()
    {
        // Shift+Enter adds and keeps the dialog open, Cmd/Ctrl+Enter adds and closes. Losing a
        // modifier on the way back would silently merge the two.
        FilteredKey? received = null;
        var filter = RenderFilter(["Enter"], key => received = key);

        await filter.Instance.OnFilteredKeyDown("Enter", shift: false, ctrl: false, meta: true);

        received.ShouldNotBeNull();
        received!.Value.ShouldBe(new FilteredKey("Enter", Shift: false, Ctrl: false, Meta: true));
    }
}
