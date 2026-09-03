using GospelPresenter.UnitTests.Support;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The tag reader behind <see cref="ServerOwnedInputValueTests"/>.
///
/// A scanner that silently reads too little is worse than no scanner: the guard still passes and
/// nobody looks again. Razor attribute values make that easy — they can hold the tag's own
/// closing character, nested quotes, and a bare <c>&lt;</c> — so each of those shapes gets a
/// case here.
/// </summary>
public class RazorInputScannerTests
{
    [Fact]
    public void ReadsAPlainTag()
    {
        const string source = """<input type="text" value="@name"/>""";

        RazorInputScanner.ReadTag(source, 0).ShouldBe(source);
    }

    [Fact]
    public void KeepsReadingPastAnArrowInsideAnAttribute()
    {
        // The > in a lambda is not the end of the tag.
        const string source = """<input @oninput="e => Handle(e)" value="@name"/>""";

        RazorInputScanner.ReadTag(source, 0).ShouldBe(source);
    }

    [Fact]
    public void KeepsReadingPastQuotesNestedInARazorExpression()
    {
        const string source = """<input @oninput="@(e => x ?? "#6b7280")" value="@name"/>""";

        RazorInputScanner.ReadTag(source, 0).ShouldBe(source);
    }

    [Fact]
    public void KeepsReadingPastALessThanInsideAnAttribute()
    {
        // The case that used to truncate the tag, hiding every attribute after it — including the
        // @oninput that makes the field an offender.
        const string source = """<input class="@(a < b ? "p" : "q")" @oninput="Handle"/>""";

        var tag = RazorInputScanner.ReadTag(source, 0);

        tag.ShouldBe(source);
        tag.ShouldContain("@oninput");
    }

    [Fact]
    public void StopsAtTheEndOfTheTag()
    {
        const string source = """<textarea @oninput="Handle"></textarea>""";

        RazorInputScanner.ReadTag(source, 0).ShouldBe("""<textarea @oninput="Handle">""");
    }

    [Fact]
    public void DoesNotTreatAnUnbalancedParenthesisInPlainTextAsAnExpression()
    {
        const string source = """<input placeholder="(0000" @oninput="Handle"/>""";

        RazorInputScanner.ReadTag(source, 0).ShouldBe(source);
    }

    [Fact]
    public void FindsAFieldThatHandsItsValueToTheServer()
    {
        const string source = """
                              <div>
                                  <input type="text" value="@query" @oninput="OnSearchInput"/>
                              </div>
                              """;

        RazorInputScanner.ServerOwnedFields(source).ShouldHaveSingleItem();
    }

    [Fact]
    public void FindsAFieldWhoseInputEventComesAfterAnAwkwardAttribute()
    {
        // Same field, but with the shape that used to hide it.
        const string source = """
                              <div>
                                  <input class="@(a < b ? "p" : "q")" value="@query" @oninput="OnSearchInput"/>
                              </div>
                              """;

        RazorInputScanner.ServerOwnedFields(source).ShouldHaveSingleItem();
    }

    [Fact]
    public void IgnoresAFieldWithNoInputEvent()
    {
        // A select's value is legitimately the server's, and so is every <option>.
        const string source = """<input type="text" value="@query" @onchange="OnChanged"/>""";

        RazorInputScanner.ServerOwnedFields(source).ShouldBeEmpty();
    }

    [Fact]
    public void IgnoresTheExemptFieldKinds()
    {
        const string sliders = """<input type="range" min="0" max="100" @oninput="OnZoom"/>""";
        const string colours = """<input type="color" value="@c" @oninput="OnColour"/>""";
        const string oneCharacter = """<input type="text" maxlength="1" value="@d" @oninput="OnDigit"/>""";

        RazorInputScanner.ServerOwnedFields(sliders).ShouldBeEmpty();
        RazorInputScanner.ServerOwnedFields(colours).ShouldBeEmpty();
        RazorInputScanner.ServerOwnedFields(oneCharacter).ShouldBeEmpty();
    }

    [Fact]
    public void DoesNotExemptALongerMaxLength()
    {
        const string source = """<input type="text" maxlength="10" value="@q" @oninput="OnInput"/>""";

        RazorInputScanner.ServerOwnedFields(source).ShouldHaveSingleItem();
    }

    [Fact]
    public void DoesNotMistakeAnAttributeForATag()
    {
        // <inputmode…> is not an <input>.
        const string source = """<div inputmode="numeric">text</div>""";

        RazorInputScanner.ServerOwnedFields(source).ShouldBeEmpty();
    }
}
