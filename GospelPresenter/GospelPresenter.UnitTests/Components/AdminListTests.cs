using Bunit;
using GospelPresenter.Shared.Components.Admin;
using GospelPresenter.UnitTests.Support;
using Microsoft.AspNetCore.Components;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// AdminList exists to make the four-state chain impossible to get wrong. The state that gets
/// forgotten is the fourth one: a search that matched nothing is not an empty collection, and
/// showing "You have no songs yet" to someone with two hundred songs and a typo is the failure
/// this component is here to prevent.
/// </summary>
public class AdminListTests : ComponentTestBase
{
    private IRenderedComponent<AdminList<string>> RenderList(IReadOnlyList<string>? items, int totalCount) =>
        RenderComponent<AdminList<string>>(parameters => parameters
            .Add(p => p.Items, items)
            .Add(p => p.TotalCount, totalCount)
            .Add(p => p.Row, (RenderFragment<string>)(item => builder =>
                builder.AddMarkupContent(0, $"<div class=\"row\">{item}</div>")))
            .Add(p => p.Empty, builder =>
                builder.AddMarkupContent(0, "<div class=\"empty\">Nothing here yet</div>")));

    [Fact]
    public void ShowsLoadingWhileItemsAreNull()
    {
        var cut = RenderList(null, totalCount: 0);

        cut.Markup.ShouldContain("Loading");
        cut.FindAll(".empty").ShouldBeEmpty();
    }

    [Fact]
    public void ShowsTheEmptyStateWhenTheCollectionIsEmpty()
    {
        RenderList([], totalCount: 0).FindAll(".empty").Count.ShouldBe(1);
    }

    [Fact]
    public void ShowsNoResultsRatherThanEmptyWhenAFilterMatchedNothing()
    {
        var cut = RenderList([], totalCount: 214);

        cut.FindAll(".empty").ShouldBeEmpty();
        cut.Markup.ShouldContain("No matches");
    }

    [Fact]
    public void RendersOneRowPerItem()
    {
        var cut = RenderList(["Amazing Grace", "Be Thou My Vision"], totalCount: 2);

        cut.FindAll(".row").Count.ShouldBe(2);
        cut.Markup.ShouldContain("Amazing Grace");
    }

    [Fact]
    public void TheLoadingLineIsDelayedSoQuickLoadsNeverFlash()
    {
        // The delay is CSS, so the only thing assertable here is that the class is applied — but
        // dropping it is exactly the regression that reintroduces the flicker.
        RenderList(null, totalCount: 0).Markup.ShouldContain("delayed-appear");
    }
}
