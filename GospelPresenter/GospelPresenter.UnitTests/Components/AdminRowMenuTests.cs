using Bunit;
using GospelPresenter.Shared.Components.Admin;
using GospelPresenter.UnitTests.Support;
using Microsoft.AspNetCore.Components;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// Where a row's actions go once it has two or more of them. The trigger has to be rendered
/// unconditionally rather than on hover: on a touch screen there is no hover, so hiding it would put
/// the only route to edit and delete out of reach entirely.
/// </summary>
public class AdminRowMenuTests : ComponentTestBase
{
    private IRenderedComponent<AdminRowMenu> RenderMenu() =>
        RenderComponent<AdminRowMenu>(parameters => parameters
            .Add(p => p.ChildContent, builder =>
            {
                builder.OpenComponent<AdminMenuItem>(0);
                builder.AddAttribute(1, "ChildContent", (RenderFragment)(b => b.AddMarkupContent(0, "Edit")));
                builder.CloseComponent();

                builder.OpenComponent<AdminMenuItem>(2);
                builder.AddAttribute(3, "Destructive", true);
                builder.AddAttribute(4, "ChildContent", (RenderFragment)(b => b.AddMarkupContent(0, "Delete")));
                builder.CloseComponent();
            }));

    [Fact]
    public void TheTriggerIsAlwaysRendered()
    {
        var cut = RenderMenu();

        cut.FindAll("button").Count.ShouldBe(1);
        cut.Markup.ShouldNotContain("Edit");
    }

    [Fact]
    public void OpeningItRevealsTheItems()
    {
        var cut = RenderMenu();

        cut.Find("button").Click();

        cut.Markup.ShouldContain("Edit");
        cut.Markup.ShouldContain("Delete");
    }

    [Fact]
    public void ADestructiveItemIsRedAndSeparatedFromWhatIsAboveIt()
    {
        var cut = RenderMenu();
        cut.Find("button").Click();

        var items = cut.FindAll("button").Where(b => b.TextContent.Trim() is "Edit" or "Delete").ToList();
        var edit = items.First(b => b.TextContent.Contains("Edit"));
        var delete = items.First(b => b.TextContent.Contains("Delete"));

        edit.ClassList.ShouldNotContain("text-red-600");
        delete.ClassList.ShouldContain("text-red-600");

        // The rule is what stops a thumb aimed at Edit from landing on Delete.
        delete.ClassList.ShouldContain("border-t");
    }

    [Fact]
    public void TheTriggerCarriesAnAccessibleName()
    {
        var cut = RenderComponent<AdminRowMenu>(parameters => parameters
            .Add(p => p.Title, "Chorus"));

        cut.Find("button").GetAttribute("title").ShouldBe("Chorus");
    }

    [Fact]
    public void TheTriggerFallsBackToTheSharedOptionsWording()
    {
        // Resolved through the real resx, so a missing Common.Options key fails here.
        RenderMenu().Find("button").GetAttribute("title").ShouldBe("Options");
    }
}
