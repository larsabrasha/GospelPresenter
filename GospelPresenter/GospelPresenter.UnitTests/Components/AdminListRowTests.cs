using Bunit;
using GospelPresenter.Shared.Components.Admin;
using GospelPresenter.UnitTests.Support;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The row's job is to keep the action zone in the same place on every page, and to survive the
/// awkward case where a row both navigates and carries buttons — nesting a button inside an anchor
/// is invalid markup and breaks keyboard handling, so those rows get a stretched link instead.
/// Getting that wrong is silent: the row still looks right and the buttons stop working.
/// </summary>
public class AdminListRowTests : ComponentTestBase
{
    [Fact]
    public void APlainNavigatingRowIsJustAnAnchor()
    {
        var cut = RenderComponent<AdminListRow>(parameters => parameters
            .Add(p => p.Href, "/admin/songs/1")
            .Add(p => p.ChildContent, builder => builder.AddMarkupContent(0, "<span>Amazing Grace</span>")));

        // No overlay, no pointer-events juggling — which also keeps the text selectable.
        cut.Find("a").GetAttribute("href").ShouldBe("/admin/songs/1");
        cut.FindAll("a.absolute").ShouldBeEmpty();
    }

    [Fact]
    public void ANavigatingRowWithActionsStretchesTheLinkInsteadOfNestingIt()
    {
        var cut = RenderComponent<AdminListRow>(parameters => parameters
            .Add(p => p.Href, "/admin/labels/1")
            .Add(p => p.LinkLabel, "Chorus")
            .Add(p => p.ChildContent, builder => builder.AddMarkupContent(0, "<span>Chorus</span>"))
            .Add(p => p.Actions, builder => builder.AddMarkupContent(0, "<button class=\"act\">x</button>")));

        var link = cut.Find("a");
        link.ClassList.ShouldContain("absolute");
        link.GetAttribute("aria-label").ShouldBe("Chorus");

        // The button must not end up inside the anchor.
        cut.Find("button.act").Closest("a").ShouldBeNull();
    }

    [Fact]
    public void ActionsStayClickableWhileTheContentFallsThroughToTheLink()
    {
        var cut = RenderComponent<AdminListRow>(parameters => parameters
            .Add(p => p.Href, "/admin/labels/1")
            .Add(p => p.ChildContent, builder => builder.AddMarkupContent(0, "<span>Chorus</span>"))
            .Add(p => p.Actions, builder => builder.AddMarkupContent(0, "<button class=\"act\">x</button>")));

        cut.Find("span").Closest("div")!.ClassList.ShouldContain("pointer-events-none");
        cut.Find("button.act").Closest("div")!.ClassList.ShouldNotContain("pointer-events-none");
    }

    [Fact]
    public void ARowWithoutAHrefIsNotInteractive()
    {
        var cut = RenderComponent<AdminListRow>(parameters => parameters
            .Add(p => p.ChildContent, builder => builder.AddMarkupContent(0, "<span>Key</span>")));

        cut.FindAll("a").ShouldBeEmpty();
        cut.Markup.ShouldNotContain("hover:bg-neutral-100");
    }

    [Fact]
    public void ReorderSitsAheadOfTheContentAndActionsStayLast()
    {
        var cut = RenderComponent<AdminListRow>(parameters => parameters
            .Add(p => p.Reorder, builder => builder.AddMarkupContent(0, "<button class=\"up\">up</button>"))
            .Add(p => p.ChildContent, builder => builder.AddMarkupContent(0, "<span>Chorus</span>"))
            .Add(p => p.Actions, builder => builder.AddMarkupContent(0, "<button class=\"more\">…</button>")));

        var markup = cut.Markup;

        // Reordering owns the far left so the action zone on the right stays put whether or not a
        // list happens to be reorderable.
        markup.IndexOf("class=\"up\"", StringComparison.Ordinal)
            .ShouldBeLessThan(markup.IndexOf("<span>Chorus</span>", StringComparison.Ordinal));
        markup.IndexOf("<span>Chorus</span>", StringComparison.Ordinal)
            .ShouldBeLessThan(markup.IndexOf("class=\"more\"", StringComparison.Ordinal));
    }
}
