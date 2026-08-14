using System.Net;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The theme-image endpoint is the one part of the theme feature that anonymous clients reach: the
/// projector at /display and every visitor's phone on a public output. It also has to work without object
/// storage, which is the case in development, in these tests and in the screenshot tool.
/// </summary>
[Collection(WebAppCollection.Name)]
public class ThemeImageEndpointTests
{
    private static string AuroraUrl(string hash) =>
        $"/api/theme-images/{BuiltInThemes.AuroraBackgroundAsset}-full-{hash}.webp";

    [Fact]
    public async Task ThemeImage_IsServedToAnonymousClients()
    {
        using var fixture = new WebAppFixture();
        var client = fixture.CreateClient();

        var response = await client.GetAsync(AuroraUrl(BuiltInThemes.AuroraBackgroundHash));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.ShouldBe("image/webp");
        (await response.Content.ReadAsByteArrayAsync()).Length.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task ThemeImage_IsCachedForever()
    {
        using var fixture = new WebAppFixture();
        var client = fixture.CreateClient();

        var response = await client.GetAsync(AuroraUrl(BuiltInThemes.AuroraBackgroundHash));

        // The hash in the URL is what makes this safe.
        response.Headers.CacheControl?.ToString().ShouldContain("immutable");
        response.Headers.CacheControl?.MaxAge.ShouldBe(TimeSpan.FromDays(365));
    }

    /// <summary>
    /// The hash busts caches; it does not authorise anything. Serving the current art for a stale hash is
    /// deliberate — a projector holding an old URL keeps working instead of showing a blank background.
    /// </summary>
    [Fact]
    public async Task ThemeImage_WithAStaleHash_StillServesTheCurrentArt()
    {
        using var fixture = new WebAppFixture();
        var client = fixture.CreateClient();

        var response = await client.GetAsync(AuroraUrl("0000000000000000"));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ThemeImage_ForAnUnknownAsset_IsNotFound()
    {
        using var fixture = new WebAppFixture();
        var client = fixture.CreateClient();

        var response = await client.GetAsync("/api/theme-images/nosuchtheme/background-full-abc.webp");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// The asset path is built from route values, so it must not be able to escape the embedded resources.
    /// </summary>
    [Theory]
    [InlineData("/api/theme-images/..%2f..%2fetc/passwd")]
    [InlineData("/api/theme-images/aurora/..%2f..%2fappsettings.json")]
    public async Task ThemeImage_CannotEscapeTheThemeAssets(string url)
    {
        using var fixture = new WebAppFixture();
        var client = fixture.CreateClient();

        var response = await client.GetAsync(url);

        response.StatusCode.ShouldBeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }
}
