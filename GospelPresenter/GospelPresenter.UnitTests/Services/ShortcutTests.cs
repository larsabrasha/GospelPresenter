using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// How a keystroke is matched and how it is written down. The matching half has to agree with the
/// copy of the same rules in utils.js — if these two drift, a shortcut stops firing on some
/// keyboards and nowhere else.
/// </summary>
public class ShortcutTests
{
    [Fact]
    public void ToToken_ForAPlainKey_HasNoModifiers()
    {
        new Shortcut("n").ToToken().ShouldBe(":n");
    }

    [Fact]
    public void ToToken_LowercasesTheKey()
    {
        new Shortcut("F2").ToToken().ShouldBe(":f2");
    }

    [Fact]
    public void ToToken_ForCtrl_MarksIt()
    {
        new Shortcut("1", Ctrl: true).ToToken().ShouldBe("c:1");
    }

    /// <summary>
    /// "?" is Shift+/ on a US keyboard and Shift+' on a Swedish one; the browser reports the same
    /// key value for both. Keeping the Shift flag would make the shortcut layout-dependent.
    /// </summary>
    [Fact]
    public void ToToken_ForAShiftedPrintableCharacter_IgnoresShift()
    {
        new Shortcut("?", Shift: true).ToToken().ShouldBe(new Shortcut("?").ToToken());
    }

    [Fact]
    public void ToToken_ForAShiftedNamedKey_KeepsShift()
    {
        new Shortcut("Enter", Shift: true).ToToken().ShouldBe("s:enter");
    }

    [Fact]
    public void ToDisplay_OnWindows_SpellsCtrlOut()
    {
        new Shortcut("1", Ctrl: true).ToDisplay(isMac: false).ShouldBe("Ctrl+1");
    }

    [Fact]
    public void ToDisplay_OnMac_UsesTheCommandSymbol()
    {
        new Shortcut("1", Ctrl: true).ToDisplay(isMac: true).ShouldBe("⌘1");
    }

    [Fact]
    public void ToDisplay_ForAnArrowKey_UsesTheArrow()
    {
        new Shortcut("ArrowDown").ToDisplay(isMac: false).ShouldBe("↓");
    }

    /// <summary>
    /// Printed as declared. "N" would tell the user to hold Shift, which is a different keystroke
    /// and would not fire this shortcut.
    /// </summary>
    [Fact]
    public void ToDisplay_ForALowercaseLetter_StaysLowercase()
    {
        new Shortcut("n").ToDisplay(isMac: false).ShouldBe("n");
    }

    [Fact]
    public void ToDisplay_ForAnUppercaseLetter_StaysUppercase()
    {
        new Shortcut("N").ToDisplay(isMac: false).ShouldBe("N");
    }
}
