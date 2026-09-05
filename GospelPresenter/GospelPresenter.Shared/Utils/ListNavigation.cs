using Microsoft.AspNetCore.Components.Web;

namespace GospelPresenter.Shared.Utils;

/// <summary>
/// Where the arrow keys should take a list. Pure arithmetic, so every list in the app agrees on
/// what Home does and on whether Down wraps, and so the rules can be tested without a browser.
///
/// Movement does not wrap. In a slide grid during a service, wrapping from the last slide back to
/// the first is the one mistake that is visible to the whole congregation — the extra keystroke
/// needed to go the long way round is cheap by comparison.
/// </summary>
public static class ListNavigation
{
    /// <summary>
    /// Works out the index the keystroke moves to.
    /// </summary>
    /// <param name="key">The browser's <c>KeyboardEvent.key</c>.</param>
    /// <param name="current">The focused index, or -1 when nothing is focused yet.</param>
    /// <param name="count">How many items the list holds.</param>
    /// <param name="orientation">
    /// Which arrows this list listens to. A grid takes all four; a vertical list ignores Left and
    /// Right so that they stay available for moving the caret, and a horizontal one ignores Up and
    /// Down so they still scroll the page.
    /// </param>
    /// <param name="next">The index to move to, when the method returns true.</param>
    /// <returns>True when the keystroke belongs to this list and the caller should handle it.</returns>
    public static bool TryMove(
        string key,
        int current,
        int count,
        ListOrientation orientation,
        out int next)
    {
        next = current;
        if (count <= 0) return false;

        var forward = key switch
        {
            "ArrowDown" when orientation is not ListOrientation.Horizontal => true,
            "ArrowRight" when orientation is not ListOrientation.Vertical => true,
            _ => false
        };
        var backward = key switch
        {
            "ArrowUp" when orientation is not ListOrientation.Horizontal => true,
            "ArrowLeft" when orientation is not ListOrientation.Vertical => true,
            _ => false
        };

        if (forward)
        {
            // From nothing, the first press lands on the first item rather than the second.
            next = current < 0 ? 0 : Math.Min(current + 1, count - 1);
            return next != current;
        }

        if (backward)
        {
            next = current < 0 ? count - 1 : Math.Max(current - 1, 0);
            return next != current;
        }

        switch (key)
        {
            case "Home":
                next = 0;
                return next != current;
            case "End":
                next = count - 1;
                return next != current;
            default:
                return false;
        }
    }

    /// <inheritdoc cref="TryMove(string,int,int,ListOrientation,out int)"/>
    public static bool TryMove(
        KeyboardEventArgs e,
        int current,
        int count,
        ListOrientation orientation,
        out int next)
    {
        // A modified arrow key means something else: the browser's own word-jump, or a shortcut
        // registered elsewhere. Only the bare keystroke moves the list.
        if (e.CtrlKey || e.MetaKey || e.AltKey || e.ShiftKey)
        {
            next = current;
            return false;
        }

        return TryMove(e.Key, current, count, orientation, out next);
    }

    /// <summary>
    /// Keeps a focused index pointing somewhere sensible after the list has changed underneath it —
    /// a search filtered the rows away, a sync removed an item, an add appended one.
    /// </summary>
    public static int Clamp(int index, int count) =>
        count <= 0 ? -1 : Math.Clamp(index, 0, count - 1);
}

public enum ListOrientation
{
    /// <summary>Up and Down move; Left and Right are left alone.</summary>
    Vertical,

    /// <summary>Left and Right move; Up and Down are left alone.</summary>
    Horizontal,

    /// <summary>
    /// All four arrows step one item. Used for the slide grid, which wraps by CSS: how many tiles
    /// fit on a row depends on the viewport, so "down means one row down" is not something the
    /// server can compute. Stepping one at a time is predictable in every window size instead.
    /// </summary>
    Grid
}
