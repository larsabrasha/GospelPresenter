using Bunit;
using GospelPresenter.Shared.Components.Admin;
using GospelPresenter.UnitTests.Support;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The toolbar every admin list page shares. Two behaviours here are the reason it exists as a
/// primitive rather than as markup copied fourteen times, and both were bugs before it did:
/// the count claiming the collection total while the list below is filtered, and the search text
/// vanishing the moment you navigate into a row and come back.
/// </summary>
public class AdminListToolbarTests : ComponentTestBase
{
    private IRenderedComponent<AdminListToolbar> RenderToolbar(
        int total = 214, int shown = 214, string search = "", bool searchable = true) =>
        RenderComponent<AdminListToolbar>(parameters => parameters
            .Add(p => p.Label, "All songs")
            .Add(p => p.Total, total)
            .Add(p => p.Shown, shown)
            .Add(p => p.Search, search)
            .Add(p => p.Searchable, searchable));

    [Fact]
    public void ShowsThePlainTotalWhenNothingIsFiltered()
    {
        RenderToolbar().Markup.ShouldContain("(214)");
    }

    [Fact]
    public void CountsMatchesAgainstTheTotalWhileFiltering()
    {
        var cut = RenderToolbar(total: 214, shown: 3, search: "grace");

        // Not "(214)": a header above three rows must not claim two hundred.
        cut.Markup.ShouldContain("(3 of 214)");
        cut.Markup.ShouldNotContain("(214)");
    }

    [Fact]
    public void PutsSearchTextInTheUrl()
    {
        var cut = RenderToolbar();

        cut.Find("input").Input("grace");

        Navigation.Uri.ShouldContain("q=grace");
    }

    [Fact]
    public void LeavesNoEmptyParameterBehindWhenSearchIsCleared()
    {
        var cut = RenderToolbar();
        cut.Find("input").Input("grace");

        cut.SetParametersAndRender(p => p.Add(x => x.Search, "grace"));
        cut.Find("button").Click();

        // A cleared search is the default state, and defaults stay out of the address bar.
        Navigation.Uri.ShouldNotContain("q=");
    }

    [Fact]
    public void AdoptsSearchTextFromTheUrl()
    {
        Navigation.NavigateTo("http://localhost/admin/songs?q=grace");

        string? reported = null;
        RenderComponent<AdminListToolbar>(parameters => parameters
            .Add(p => p.Label, "All songs")
            .Add(p => p.Total, 214)
            .Add(p => p.Searchable, true)
            .Add(p => p.Search, "")
            .Add(p => p.SearchChanged, value => reported = value));

        // This is what makes a shared link land on the filtered view, and what stops a trip into a
        // detail page and back from wiping the search.
        reported.ShouldBe("grace");
    }

    [Fact]
    public void OmitsTheSearchFieldWhenTheListIsNotSearchable()
    {
        RenderToolbar(searchable: false).FindAll("input").ShouldBeEmpty();
    }
}
