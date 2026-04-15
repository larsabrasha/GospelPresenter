using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class BibleMetadataTests
{
    [Fact]
    public void ParseCoprHtml_ExtractsNameFromTitle()
    {
        var html = """
            <html><head>
            <title>Svenska Kärnbibeln - en expanderad översättning  </title>
            </head></html>
            """;

        var (_, name) = BibleService.ParseCoprHtml(html);

        name.ShouldBe("Svenska Kärnbibeln - en expanderad översättning");
    }

    [Fact]
    public void ParseCoprHtml_AbbreviationFromTitleInitials()
    {
        var html = """
            <html><head>
            <title>Svenska Kärnbibeln - en expanderad översättning</title>
            </head></html>
            """;

        var (abbreviation, _) = BibleService.ParseCoprHtml(html);

        abbreviation.ShouldBe("SK");
    }

    [Fact]
    public void ParseCoprHtml_AbbreviationFromEnglishTitle()
    {
        var html = """
            <html><head>
            <title>King James Version</title>
            </head></html>
            """;

        var (abbreviation, _) = BibleService.ParseCoprHtml(html);

        abbreviation.ShouldBe("KJV");
    }

    [Fact]
    public void ParseCoprHtml_NoTitle_ReturnsUnknownBible()
    {
        var html = "<html><head></head></html>";

        var (_, name) = BibleService.ParseCoprHtml(html);

        name.ShouldBe("Unknown Bible");
    }

    [Fact]
    public void ParseCoprHtml_NoTitle_ReturnsUnknownAbbreviation()
    {
        var html = "<html><head></head></html>";

        var (abbreviation, _) = BibleService.ParseCoprHtml(html);

        abbreviation.ShouldBe("UNKNOWN");
    }

    [Theory]
    [InlineData("Svenska Folkbibeln", "SF")]
    [InlineData("New International Version", "NIV")]
    public void BuildAbbreviation_UsesUppercaseInitials(string name, string expected)
    {
        BibleService.BuildAbbreviation(name).ShouldBe(expected);
    }

    [Theory]
    [InlineData("en liten bibel")]
    [InlineData("Bibel 2000")]
    [InlineData("x")]
    public void BuildAbbreviation_TooFewInitials_ReturnsNull(string name)
    {
        BibleService.BuildAbbreviation(name).ShouldBeNull();
    }
}
