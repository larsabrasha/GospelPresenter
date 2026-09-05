using GospelPresenter.Shared.Utils;
using Microsoft.AspNetCore.Components.Web;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Where the arrow keys take a list. Shared by every keyboard-navigable list in the app, so that
/// they cannot disagree about whether Down wraps or what Home does from nowhere.
/// </summary>
public class ListNavigationTests
{
    [Fact]
    public void TryMove_DownFromNothing_LandsOnTheFirstItem()
    {
        ListNavigation.TryMove("ArrowDown", current: -1, count: 5, ListOrientation.Vertical, out var next)
            .ShouldBeTrue();
        next.ShouldBe(0);
    }

    [Fact]
    public void TryMove_UpFromNothing_LandsOnTheLastItem()
    {
        ListNavigation.TryMove("ArrowUp", current: -1, count: 5, ListOrientation.Vertical, out var next);

        next.ShouldBe(4);
    }

    [Fact]
    public void TryMove_DownFromTheMiddle_StepsOne()
    {
        ListNavigation.TryMove("ArrowDown", current: 2, count: 5, ListOrientation.Vertical, out var next);

        next.ShouldBe(3);
    }

    /// <summary>
    /// Wrapping from the last slide back to the first is the one mistake a congregation can see.
    /// </summary>
    [Fact]
    public void TryMove_DownFromTheLastItem_DoesNotWrap()
    {
        ListNavigation.TryMove("ArrowDown", current: 4, count: 5, ListOrientation.Vertical, out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void TryMove_UpFromTheFirstItem_DoesNotWrap()
    {
        ListNavigation.TryMove("ArrowUp", current: 0, count: 5, ListOrientation.Vertical, out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void TryMove_Home_GoesToTheFirstItem()
    {
        ListNavigation.TryMove("Home", current: 3, count: 5, ListOrientation.Vertical, out var next);

        next.ShouldBe(0);
    }

    [Fact]
    public void TryMove_End_GoesToTheLastItem()
    {
        ListNavigation.TryMove("End", current: 1, count: 5, ListOrientation.Vertical, out var next);

        next.ShouldBe(4);
    }

    [Fact]
    public void TryMove_InAVerticalList_IgnoresTheHorizontalArrows()
    {
        ListNavigation.TryMove("ArrowRight", current: 1, count: 5, ListOrientation.Vertical, out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void TryMove_InAHorizontalList_IgnoresTheVerticalArrows()
    {
        ListNavigation.TryMove("ArrowDown", current: 1, count: 5, ListOrientation.Horizontal, out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void TryMove_InAGrid_TakesTheHorizontalArrows()
    {
        ListNavigation.TryMove("ArrowRight", current: 1, count: 5, ListOrientation.Grid, out var next);

        next.ShouldBe(2);
    }

    [Fact]
    public void TryMove_InAGrid_TakesTheVerticalArrows()
    {
        ListNavigation.TryMove("ArrowDown", current: 1, count: 5, ListOrientation.Grid, out var next);

        next.ShouldBe(2);
    }

    [Fact]
    public void TryMove_InAnEmptyList_DoesNothing()
    {
        ListNavigation.TryMove("ArrowDown", current: -1, count: 0, ListOrientation.Vertical, out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void TryMove_ForAnUnrelatedKey_DoesNothing()
    {
        ListNavigation.TryMove("a", current: 1, count: 5, ListOrientation.Vertical, out _)
            .ShouldBeFalse();
    }

    /// <summary>
    /// Ctrl+Down and friends belong to the browser or to a registered shortcut, not to the list.
    /// </summary>
    [Fact]
    public void TryMove_WithAModifierHeld_DoesNothing()
    {
        var e = new KeyboardEventArgs { Key = "ArrowDown", CtrlKey = true };

        ListNavigation.TryMove(e, current: 1, count: 5, ListOrientation.Vertical, out _)
            .ShouldBeFalse();
    }

    [Fact]
    public void TryMove_WithNoModifier_MovesAsUsual()
    {
        var e = new KeyboardEventArgs { Key = "ArrowDown" };

        ListNavigation.TryMove(e, current: 1, count: 5, ListOrientation.Vertical, out var next);

        next.ShouldBe(2);
    }

    [Fact]
    public void Clamp_WithAnIndexPastTheEnd_PullsItBackToTheLastItem()
    {
        ListNavigation.Clamp(index: 9, count: 5).ShouldBe(4);
    }

    [Fact]
    public void Clamp_WithAnEmptyList_ReportsNothingFocused()
    {
        ListNavigation.Clamp(index: 3, count: 0).ShouldBe(-1);
    }
}
