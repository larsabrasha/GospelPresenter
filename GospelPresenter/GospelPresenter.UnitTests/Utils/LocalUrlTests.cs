using GospelPresenter.Shared.Utils;
using Shouldly;

namespace GospelPresenter.UnitTests.Utils;

/// <summary>
/// /signin hands its returnUrl to the provider challenge, and the callback redirects to it after a
/// genuine sign-in, so anything that is not a path on this site is an open redirect.
/// </summary>
public class LocalUrlTests
{
    private const string Host = "presenter.example.org";

    [Theory]
    [InlineData("/")]
    [InlineData("/presentations/abc")]
    [InlineData("/settings?tab=language#top")]
    public void OrFallback_KeepsLocalPaths(string returnUrl)
    {
        LocalUrl.OrFallback(returnUrl, Host).ShouldBe(returnUrl);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("https://evil.example/")]
    [InlineData("http://evil.example/phish")]
    [InlineData("//evil.example/")]
    [InlineData("/\\evil.example/")]
    [InlineData("\\\\evil.example/")]
    [InlineData("/\t/evil.example/")]
    [InlineData("javascript:alert(1)")]
    [InlineData("evil.example")]
    [InlineData("https://presenter.example.org.evil.example/")]
    [InlineData("https://presenter.example.org@evil.example/")]
    [InlineData("https://user@presenter.example.org/")]
    [InlineData("ftp://presenter.example.org/")]
    public void OrFallback_SendsEverythingElseHome(string? returnUrl)
    {
        LocalUrl.OrFallback(returnUrl, Host).ShouldBe(LocalUrl.Fallback);
    }

    [Theory]
    [InlineData("https://presenter.example.org/presentations/abc?x=1", "/presentations/abc?x=1")]
    [InlineData("http://PRESENTER.example.org/settings", "/settings")]
    public void OrFallback_ReducesAnAbsoluteUrlOnThisHostToItsPath(string returnUrl, string expected)
    {
        LocalUrl.OrFallback(returnUrl, Host).ShouldBe(expected);
    }

    [Fact]
    public void OrFallback_WithoutAHost_AcceptsNoAbsoluteUrl()
    {
        LocalUrl.OrFallback($"https://{Host}/settings").ShouldBe(LocalUrl.Fallback);
    }
}
