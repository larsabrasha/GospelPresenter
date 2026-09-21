using AngleSharp.Html.Parser;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Bible slides are stored as HTML and rendered as markup, and a device can push a part with no
/// encoder in between. These tests pin the gate every render goes through: the service's own output
/// passes unchanged in meaning, every historical storage form still renders, and nothing that is not
/// the service's grammar ever comes out as an element.
/// </summary>
public class BibleSlideHtmlTests
{
    private static readonly HtmlParser Parser = new();

    [Fact]
    public void Sanitize_TheServicesOwnOutput_KeepsItsStructureAndText()
    {
        var verses = new List<Verse>
        {
            new("b", 1, 1, "Så älskade Gud & världen \"så\" att han gav sin 'ende' Son <3"),
            new("b", 1, 2, "Ty så säger Herren: åäö ÅÄÖ"),
        };
        var html = new BibleTextService().Create(verses).Parts.ShouldHaveSingleItem();

        var sanitized = BibleSlideHtml.Sanitize(html);

        BibleSlideHtml.IsWellFormed(html).ShouldBeTrue();
        Text(sanitized).ShouldBe(Text(html));
        Elements(sanitized).ShouldBe(Elements(html));
        Text(sanitized).ShouldContain("Gud & världen \"så\" att han gav sin 'ende' Son <3");
        // Idempotent: the second pass finds encoded text and leaves it encoded exactly once.
        BibleSlideHtml.Sanitize(sanitized).ShouldBe(sanitized);
    }

    [Theory]
    [InlineData("<div><sup>1</sup> I begynnelsen skapade Gud himmel och jord.</div>")]
    [InlineData("<div class=\"text-left\"><sup class=\"opacity-40\">16</sup> Ty så älskade Gud</div>")]
    [InlineData("<sup class=\"opacity-40\">1</sup> No wrapper at all")]
    [InlineData("Herren är min herde,\nmig skall intet fattas.")]
    public void Sanitize_EveryHistoricalStorageForm_IsAcceptedAndRendersItsText(string stored)
    {
        BibleSlideHtml.IsWellFormed(stored).ShouldBeTrue();
        var sanitized = BibleSlideHtml.Sanitize(stored);

        Text(sanitized).ShouldBe(Text(stored));
        Elements(sanitized).ShouldBeSubsetOf(["div", "sup"]);
    }

    [Fact]
    public void Sanitize_RawLegacyTextWithAnAmpersand_EncodesItExactlyOnce()
    {
        var stored = "<div><sup>1</sup> Gud & människa \"sa\" det</div>";

        var sanitized = BibleSlideHtml.Sanitize(stored);

        sanitized.ShouldContain("Gud &amp; människa &quot;sa&quot; det");
        sanitized.ShouldNotContain("&amp;amp;");
    }

    [Fact]
    public void Sanitize_AnEncodedTagInTheText_StaysText()
    {
        var stored = "<div class=\"text-left\">&lt;img src=x onerror=alert(1)&gt;</div>";

        var sanitized = BibleSlideHtml.Sanitize(stored);

        Elements(sanitized).ShouldBe(["div"]);
        Text(sanitized).ShouldBe("<img src=x onerror=alert(1)>");
    }

    [Theory]
    [InlineData("<img src=x onerror=alert(1)>")]
    [InlineData("<div class=\"text-left\" onmouseover=\"x\">t</div>")]
    [InlineData("<sup class=\"opacity-40\" onclick=\"x\">1</sup>")]
    [InlineData("<sup class='opacity-40'>1</sup>")]
    [InlineData("<SUP CLASS=\"opacity-40\">1</SUP>")]
    [InlineData("<sup class=\"opacity-40\">alert</sup>")]
    [InlineData("<sup class=\"opacity-40\">1</sup")]
    [InlineData("<sup class=\"opacity-40\">1<img src=x onerror=1></sup>")]
    [InlineData("<div class=\"text-left\">t</div><img src=x onerror=1>")]
    [InlineData("<div class=\"text-left\"><div class=\"text-left\">t</div></div>")]
    [InlineData("<div class=\"text-left\"><a href=\"javascript:alert(1)\">x</a></div>")]
    [InlineData("<div class=\"text-left\">t</div></div>")]
    [InlineData("<svg onload=alert(1)>")]
    [InlineData("<div class=\"text-left\">t<!--<img src=x onerror=1>--></div>")]
    [InlineData("<div style=\"background:url(javascript:1)\">t</div>")]
    public void Sanitize_ForeignMarkup_IsRejectedAndRendersAsTextOnly(string payload)
    {
        BibleSlideHtml.IsWellFormed(payload).ShouldBeFalse();

        var sanitized = BibleSlideHtml.Sanitize(payload);

        var document = Parser.ParseDocument(sanitized);
        document.Body!.QuerySelectorAll("*").ShouldBeEmpty("nothing in the payload may survive as an element");
        sanitized.ShouldNotContain("<img");
        sanitized.ShouldNotContain("<svg");
        sanitized.ShouldNotContain("onerror");
        sanitized.ShouldNotContain("onload");
        sanitized.ShouldNotContain("<a ");
    }

    [Fact]
    public void Sanitize_Null_IsEmpty()
    {
        BibleSlideHtml.Sanitize(null).ShouldBe("");
        BibleSlideHtml.IsWellFormed(null).ShouldBeTrue();
    }

    private static string Text(string html) => Parser.ParseDocument(html).Body!.TextContent;

    private static List<string> Elements(string html) =>
        Parser.ParseDocument(html).Body!.QuerySelectorAll("*").Select(e => e.LocalName).ToList();
}
