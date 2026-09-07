using System.Net;
using GospelPresenter.IntegrationTests.Fixtures;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The headers every answer carries, and the one exception: the public watch page may be framed
/// by a congregation's own website, nothing else may be framed at all.
/// </summary>
[Collection(WebAppCollection.Name)]
public class SecurityHeadersIntegrationTests
{
    [Fact]
    public async Task AnOrdinaryPage_RefusesFramingAndSniffing()
    {
        using var app = new WebAppFixture();
        var client = await app.CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/");

        response.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);
        response.Headers.GetValues("X-Frame-Options").ShouldBe(["DENY"]);
        response.Headers.GetValues("Referrer-Policy").ShouldBe(["strict-origin-when-cross-origin"]);
        response.Headers.GetValues("Content-Security-Policy").Single().ShouldContain("frame-ancestors 'none'");
    }

    [Fact]
    public async Task TheWatchPage_MayBeFramed_ButStillRefusesSniffing()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient();

        // An unknown code, so no output needs to exist: the headers are set for the path regardless.
        var response = await client.GetAsync("/watch/nosuchcode");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        response.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);
        response.Headers.Contains("X-Frame-Options").ShouldBeFalse();
        response.Headers.GetValues("Content-Security-Policy").Single().ShouldNotContain("frame-ancestors");
    }

    /// <summary>
    /// A watch code is the only thing between a stranger and a congregation's slides, and nothing
    /// used to slow down guessing at it. A client that keeps presenting wrong codes is cut off; a
    /// client presenting the right one is never counted.
    /// </summary>
    [Fact]
    public async Task GuessingWatchCodes_IsCutOffAfterTooManyMisses()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient();

        HttpResponseMessage? last = null;
        for (var i = 0; i < GospelPresenter.Web.Security.FailureThrottle.MaxFailures; i++)
            last = await client.GetAsync($"/watch/guess{i:000}");
        last!.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var blocked = await client.GetAsync("/watch/guess999");

        blocked.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task GuessingCalendarTokens_IsCutOffAfterTooManyMisses()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient();

        for (var i = 0; i < GospelPresenter.Web.Security.FailureThrottle.MaxFailures; i++)
            (await client.GetAsync($"/api/calendar/guess{i:000}.ics")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await client.GetAsync("/api/calendar/guess999.ics")).StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task GuessingMcpApiKeys_IsCutOffAfterTooManyMisses()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient();

        for (var i = 0; i < GospelPresenter.Web.Security.FailureThrottle.MaxFailures; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp");
            request.Headers.Authorization = new("Bearer", $"gp_wrong{i}");
            (await client.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        }

        using var blockedRequest = new HttpRequestMessage(HttpMethod.Post, "/mcp");
        blockedRequest.Headers.Authorization = new("Bearer", "gp_wrong999");
        (await client.SendAsync(blockedRequest)).StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
    }
}
