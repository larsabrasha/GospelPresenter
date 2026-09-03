using Bunit;
using GospelPresenter.Shared.Components;
using GospelPresenter.Shared.Localization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The value ownership rule in <see cref="DomOwnedInputBase"/>, which is the whole fix for
/// characters being swapped or reverted while typing.
///
/// Blazor writes a text field's value from server state on every render, and over a circuit the
/// server is always at least one roundtrip behind the keyboard. Any render that lands while
/// someone is typing therefore used to write a stale value into the field. The rule here is that
/// the field stops following its Value parameter from the first keystroke onwards, and takes a
/// new one only when the caller bumps Revision.
///
/// Both directions matter and both are easy to break by accident. Drop the freeze and the
/// original bug is back. Drop the Revision escape hatch and every clear button in the app
/// silently stops working — nothing throws, the field simply keeps its text.
/// </summary>
public class DomOwnedInputTests : TestContext
{
    public DomOwnedInputTests()
    {
        // setInputValue is called when a Revision bump hands ownership back.
        JSInterop.Mode = JSRuntimeMode.Loose;
        Services.AddLogging();
        Services.AddLocalization();
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new Microsoft.Extensions.Options.OptionsWrapper<LocalizationOptions>(new LocalizationOptions()),
                    NullLoggerFactory.Instance)));
    }

    private IRenderedComponent<SimpleInput> RenderField(string value = "", int revision = 0) =>
        RenderComponent<SimpleInput>(parameters => parameters
            .Add(p => p.Id, "field")
            .Add(p => p.Value, value)
            .Add(p => p.Revision, revision));

    private static string RenderedValue(IRenderedComponent<SimpleInput> field) =>
        field.Find("input").GetAttribute("value") ?? "";

    [Fact]
    public void TracksValueUntilTheUserTypes()
    {
        // A form whose data arrives after the first render is the common case, and it has to
        // keep working: until someone touches the field, the server owns it.
        var field = RenderField();

        field.SetParametersAndRender(parameters => parameters.Add(p => p.Value, "loaded"));

        RenderedValue(field).ShouldBe("loaded");
    }

    [Fact]
    public void IgnoresValueOnceTheUserHasTyped()
    {
        var field = RenderField();

        field.Find("input").Input("matteus 5");
        // A render triggered from somewhere else — an autosave, a hub callback, a search
        // returning — carrying the server's copy of the value, which is behind the keyboard.
        field.SetParametersAndRender(parameters => parameters.Add(p => p.Value, "matteu"));

        RenderedValue(field).ShouldBe("");
    }

    [Fact]
    public void TakesTheValueAgainWhenRevisionIsBumped()
    {
        var field = RenderField();
        field.Find("input").Input("matteus 5");

        field.SetParametersAndRender(parameters => parameters
            .Add(p => p.Value, "genesis")
            .Add(p => p.Revision, 1));

        RenderedValue(field).ShouldBe("genesis");
    }

    [Fact]
    public void WritesTheValueThroughJsWhenRevisionIsBumped()
    {
        // Clearing a search field bumps Revision back to the value the render tree already
        // holds, so Blazor's diff emits no DOM edit at all. Without the direct write the field
        // would keep the text the user typed.
        var invocation = JSInterop.SetupVoid("setInputValue", _ => true);
        var field = RenderField();
        field.Find("input").Input("matteus 5");

        field.SetParametersAndRender(parameters => parameters
            .Add(p => p.Value, "")
            .Add(p => p.Revision, 1));

        var calls = invocation.Invocations["setInputValue"];
        calls.Count.ShouldBe(1);
        calls[0].Arguments[1].ShouldBe("");
    }

    [Fact]
    public void KeepsIgnoringValueAfterARevisionBump()
    {
        // A bump delivers one value; it does not hand ownership back. Handing it back would leave
        // a window — until the next keystroke completed a round trip — in which an unrelated
        // re-render could write value again, and the rule is "never while the user is typing",
        // not "rarely". A caller that wants to set the value twice bumps twice.
        var field = RenderField();
        field.Find("input").Input("matteus 5");
        field.SetParametersAndRender(parameters => parameters
            .Add(p => p.Value, "")
            .Add(p => p.Revision, 1));

        field.SetParametersAndRender(parameters => parameters.Add(p => p.Value, "set by the app"));

        RenderedValue(field).ShouldBe("");
    }

    [Fact]
    public void TakesASecondBump()
    {
        var field = RenderField();
        field.Find("input").Input("matteus 5");
        field.SetParametersAndRender(parameters => parameters
            .Add(p => p.Value, "")
            .Add(p => p.Revision, 1));

        field.SetParametersAndRender(parameters => parameters
            .Add(p => p.Value, "set by the app")
            .Add(p => p.Revision, 2));

        RenderedValue(field).ShouldBe("set by the app");
    }

    [Fact]
    public void InstallsTheBrowserThrottleWithTheIntervalItWasGiven()
    {
        // The throttle itself is JavaScript and cannot be exercised here, but the interval
        // crossing the boundary can: it is what decides whether typing feels immediate.
        RenderComponent<SimpleInput>(parameters => parameters
            .Add(p => p.Id, "field")
            .Add(p => p.Value, "")
            .Add(p => p.ThrottleMs, 120));

        var calls = JSInterop.Invocations["initThrottledInput"];
        calls.Count.ShouldBe(1);
        calls[0].Arguments[2].ShouldBe(120);
    }

    [Fact]
    public void InstallsNoThrottleForAnUnthrottledField()
    {
        // Form fields must stay unthrottled: delaying the model would delay autosave and
        // validation for an optimisation they do not need.
        RenderField();

        JSInterop.Invocations["initThrottledInput"].ShouldBeEmpty();
    }

    [Fact]
    public void RendersTheClearButtonWhetherOrNotTheFieldHasAValue()
    {
        // The button hides itself with CSS while the field is empty. Making it a conditional
        // render instead would reintroduce the bug from the other side: the condition reads the
        // value, so the parent would have to re-render per keystroke to keep it up to date.
        var field = RenderComponent<SimpleInput>(parameters => parameters
            .Add(p => p.Id, "field")
            .Add(p => p.Value, "")
            .Add(p => p.Clearable, true));

        var button = field.Find("button");
        (button.ClassName ?? "").ShouldContain("peer-placeholder-shown:hidden");

        // A placeholder has to be present for :placeholder-shown to ever match.
        field.Find("input").GetAttribute("placeholder").ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public void WiresNoKeyHandlerWhenTheCallerAsksForNone()
    {
        // The search fields deliberately pass no OnKeyDown: their shortcuts are filtered in the
        // browser by KeyFilter, so ordinary typing never reaches the server. If Blazor attached
        // a listener for an empty EventCallback anyway, every keystroke would still cost a
        // roundtrip and the filtering would buy nothing — silently.
        var field = RenderField();

        Should.Throw<MissingEventHandlerException>(() => field.Find("input").KeyDown("a"));
    }

    [Fact]
    public void ReportsWhatTheUserTyped()
    {
        var reported = new List<string>();
        var field = RenderComponent<SimpleInput>(parameters => parameters
            .Add(p => p.Id, "field")
            .Add(p => p.Value, "")
            .Add(p => p.ValueChanged, reported.Add));

        field.Find("input").Input("matteus 5");

        reported.ShouldBe(["matteus 5"]);
    }
}
