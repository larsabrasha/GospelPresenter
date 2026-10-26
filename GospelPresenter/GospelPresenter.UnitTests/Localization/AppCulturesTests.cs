using GospelPresenter.Shared.Localization;
using Shouldly;

namespace GospelPresenter.UnitTests.Localization;

/// <summary>/culture stores what it is given as the user's language, so it may only take one the app has.</summary>
public class AppCulturesTests
{
    [Theory]
    [InlineData("en", "en")]
    [InlineData("sv", "sv")]
    [InlineData("SV", "sv")]
    [InlineData(" en ", "en")]
    public void Normalize_ASupportedCulture_ReturnsItsCanonicalName(string culture, string expected)
    {
        AppCultures.Normalize(culture).ShouldBe(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("de")]
    [InlineData("sv-SE")]
    [InlineData("en|sv")]
    [InlineData("<script>")]
    public void Normalize_AnythingElse_ReturnsNull(string? culture)
    {
        AppCultures.Normalize(culture).ShouldBeNull();
    }

    [Fact]
    public void Default_IsEnglish()
    {
        AppCultures.Default.ShouldBe("en");
    }
}
