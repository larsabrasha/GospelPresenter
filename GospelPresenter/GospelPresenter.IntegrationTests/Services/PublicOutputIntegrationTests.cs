using System.Net;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The anonymous watch surface — the one a stranger with a code reaches.
/// </summary>
[Collection(WebAppCollection.Name)]
public class PublicOutputIntegrationTests
{
    private const string OrganizationId = "mock-org-sv";

    [Fact]
    public async Task WatchPage_ForAKnownOutput_RendersTheWaitingScreen()
    {
        using var app = new WebAppFixture();
        // ASCII on purpose: the renderer writes non-ASCII as character references.
        var code = await AddPublicOutputAsync(app, "Follow along");
        var client = app.CreateClient();

        var response = await client.GetAsync($"/watch/{code}");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("text/html");
        (await response.Content.ReadAsStringAsync()).ShouldContain("Follow along");
    }

    [Fact]
    public async Task WatchPage_ForAScreensIdentifier_IsNotFound()
    {
        // A registered screen's identifier is a private credential; the public page must not answer to it.
        using var app = new WebAppFixture();
        var code = await AddOutputAsync(app, "Projector", OutputKind.Screen);
        var client = app.CreateClient();

        (await client.GetAsync($"/watch/{code}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Stream_WithoutOrWithAnOversizedViewerId_IsRejected()
    {
        using var app = new WebAppFixture();
        var code = await AddPublicOutputAsync(app, "Följ med");
        var client = app.CreateClient();

        (await client.GetAsync($"/api/watch/{code}/stream")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await client.GetAsync($"/api/watch/{code}/stream?v={new string('x', 65)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ImageProxy_ForAnOutputNobodyIsBroadcastingTo_IsNotFound()
    {
        using var app = new WebAppFixture();
        var code = await AddPublicOutputAsync(app, "Följ med");
        var client = app.CreateClient();

        (await client.GetAsync($"/api/watch/{code}/image/org-image/any-id/full")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await client.GetAsync($"/api/watch/{code}/image/slides/any-id/1")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private static Task<string> AddPublicOutputAsync(WebAppFixture app, string name) => AddOutputAsync(app, name, OutputKind.PublicQr);

    private static async Task<string> AddOutputAsync(WebAppFixture app, string name, OutputKind kind)
    {
        using var scope = app.Services.CreateScope();
        var displays = scope.ServiceProvider.GetRequiredService<IRemoteDisplayService>();
        var caller = new CallerContext(WebAppFixture.MockUserId, UserRole.Admin, OrganizationId);
        return (await displays.AddDisplayAsync(OrganizationId, name, caller, kind)).DisplayIdentifier;
    }
}
