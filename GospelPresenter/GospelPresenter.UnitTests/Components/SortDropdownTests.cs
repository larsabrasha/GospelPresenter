using Bunit;
using GospelPresenter.Shared.Components;
using GospelPresenter.Shared.Services;
using GospelPresenter.UnitTests.Support;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The sort control lifted out of Presentations.razor so every admin list can use it. Tested against
/// PresentationSortOrder deliberately: those .resx keys already exist, so these tests also prove the
/// "{LabelPrefix}.Sort.{value}" lookup convention still resolves against real resources.
/// </summary>
public class SortDropdownTests : ComponentTestBase
{
    private IRenderedComponent<SortDropdown<PresentationSortOrder>> RenderDropdown(
        PresentationSortOrder value = PresentationSortOrder.UpdatedDesc,
        Action<PresentationSortOrder>? onChange = null) =>
        RenderComponent<SortDropdown<PresentationSortOrder>>(parameters => parameters
            .Add(p => p.Value, value)
            .Add(p => p.LabelPrefix, "Presentations")
            .Add(p => p.Default, PresentationSortOrder.UpdatedDesc)
            .Add(p => p.ValueChanged, v => onChange?.Invoke(v)));

    private void OpenMenu(IRenderedComponent<SortDropdown<PresentationSortOrder>> cut) =>
        cut.Find("button").Click();

    [Fact]
    public void LabelsTheTriggerWithTheCurrentChoice()
    {
        // Resolved through the real resx; a renamed or missing key would surface the raw key here.
        RenderDropdown().Markup.ShouldContain("Recently modified");
    }

    [Fact]
    public void OffersEveryDeclaredOption()
    {
        var cut = RenderDropdown();
        OpenMenu(cut);

        // Trigger plus one button per option.
        cut.FindAll("button").Count.ShouldBe(Enum.GetValues<PresentationSortOrder>().Length + 1);
    }

    [Fact]
    public void WritesANonDefaultChoiceToTheUrl()
    {
        var cut = RenderDropdown();
        OpenMenu(cut);

        cut.FindAll("button").First(b => b.TextContent.Contains("Name")).Click();

        Navigation.Uri.ShouldContain("sort=NameAsc");
    }

    [Fact]
    public void KeepsTheDefaultChoiceOutOfTheUrl()
    {
        var cut = RenderDropdown(value: PresentationSortOrder.NameAsc);
        OpenMenu(cut);

        cut.FindAll("button").First(b => b.TextContent.Contains("Recently modified")).Click();

        // /presentations should not become /presentations?sort=UpdatedDesc just for being the default.
        Navigation.Uri.ShouldNotContain("sort=");
    }

    [Fact]
    public void AdoptsTheChoiceFromTheUrl()
    {
        Navigation.NavigateTo("http://localhost/presentations?sort=NameAsc");

        PresentationSortOrder? reported = null;
        RenderDropdown(onChange: v => reported = v);

        reported.ShouldBe(PresentationSortOrder.NameAsc);
    }

    [Fact]
    public void IgnoresAnUnparsableSortParameter()
    {
        Navigation.NavigateTo("http://localhost/presentations?sort=nonsense");

        PresentationSortOrder? reported = null;
        var cut = RenderDropdown(onChange: v => reported = v);

        // A hand-edited or stale link must not throw or blank the list; it falls back to the default.
        reported.ShouldBeNull();
        cut.Markup.ShouldContain("Recently modified");
    }
}
