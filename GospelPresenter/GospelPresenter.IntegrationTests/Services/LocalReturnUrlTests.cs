using GospelPresenter.Web.Auth;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// /signin?returnUrl= is where a user lands right after a real Google or OIDC login. Anything but a
/// path on this site turns that into a phishing page with a genuine login in front of it.
/// </summary>
public class LocalReturnUrlTests
{
    [Theory]
    [InlineData("/", "/")]
    [InlineData("/presentations/abc?tab=live", "/presentations/abc?tab=live")]
    [InlineData("/admin/users", "/admin/users")]
    public void Sanitize_ALocalPath_IsKept(string given, string expected)
    {
        LocalReturnUrl.Sanitize(given).ShouldBe(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("https://evil.example/")]
    [InlineData("http://evil.example/")]
    [InlineData("//evil.example/")]
    [InlineData("/\\evil.example/")]
    [InlineData("javascript:alert(1)")]
    [InlineData("evil.example")]
    [InlineData("/ok\r\nLocation: https://evil.example")]
    public void Sanitize_AnythingElse_FallsBackToTheFrontPage(string? given)
    {
        LocalReturnUrl.Sanitize(given).ShouldBe("/");
    }
}
