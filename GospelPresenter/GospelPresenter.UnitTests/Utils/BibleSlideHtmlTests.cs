using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Utils;
using Shouldly;

namespace GospelPresenter.UnitTests.Utils;

/// <summary>
/// Bible slides are rendered as markup, including on the anonymous public /watch page, while the stored
/// HTML can come from anywhere that writes a presentation part — a device's sync push among them. The
/// sanitizer must keep exactly what the Bible formatter produces and neutralise everything else.
/// </summary>
public class BibleSlideHtmlTests
{
    [Fact]
    public void Sanitize_KeepsWhatTheBibleFormatterProduces()
    {
        // Arrange -- verse text with characters that arrive encoded, as the formatter emits them
        var bibleText = new BibleTextService().Create(
        [
            new Verse("JHN", 3, 16, "For God so loved <the> world & \"all\""),
            new Verse("JHN", 3, 17, "For God sent not his Son"),
        ]);
        var html = bibleText.Parts.ShouldHaveSingleItem();

        // Act & Assert
        BibleSlideHtml.Sanitize(html).ShouldBe(html);
    }

    [Theory]
    [InlineData("<div>Plain</div>")]
    [InlineData("<div class=\"text-left\"><sup>1</sup> In the beginning</div>")]
    [InlineData("<div>Line one<br>line two</div>")]
    public void Sanitize_KeepsTheFormatsStoredBeforeThemes(string html)
    {
        BibleSlideHtml.Sanitize(html).ShouldBe(html);
    }

    [Theory]
    [InlineData("<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;")]
    [InlineData("<img src=x onerror=alert(1)>", "&lt;img src=x onerror=alert(1)&gt;")]
    [InlineData("<div onclick=\"alert(1)\">x</div>", "&lt;div onclick=&quot;alert(1)&quot;&gt;x")]
    [InlineData("<div class=\"text-left\" onclick=\"alert(1)\">x</div>", "&lt;div class=&quot;text-left&quot; onclick=&quot;alert(1)&quot;&gt;x")]
    [InlineData("<div class=\"fixed inset-0\">x</div>", "&lt;div class=&quot;fixed inset-0&quot;&gt;x")]
    [InlineData("<sup style=\"color:red\">1</sup>", "&lt;sup style=&quot;color:red&quot;&gt;1")]
    [InlineData("<a href=\"javascript:alert(1)\">x</a>", "&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;")]
    [InlineData("<svg/onload=alert(1)>", "&lt;svg/onload=alert(1)&gt;")]
    [InlineData("<<script>>", "&lt;&lt;script&gt;&gt;")]
    [InlineData("text <unterminated", "text &lt;unterminated")]
    [InlineData("a > b", "a &gt; b")]
    public void Sanitize_EncodesEverythingOutsideTheAllowList(string html, string expected)
    {
        BibleSlideHtml.Sanitize(html).ShouldBe(expected);
    }

    [Theory]
    [InlineData("</div></div>x", "x")]
    [InlineData("<div><sup>1", "<div><sup>1</sup></div>")]
    [InlineData("<div><sup>1</div>", "<div><sup>1</sup></div>")]
    public void Sanitize_BalancesTags_SoAPartCannotCloseTheSlidesOwnWrapper(string html, string expected)
    {
        BibleSlideHtml.Sanitize(html).ShouldBe(expected);
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("&lt;b&gt; &amp; &#39;", "&lt;b&gt; &amp; &#39;")]
    public void Sanitize_LeavesEntitiesAlone(string? html, string expected)
    {
        BibleSlideHtml.Sanitize(html).ShouldBe(expected);
    }
}
