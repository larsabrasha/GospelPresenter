using System.Net;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The two projector pages. /live shows a session's slides and is opened by the operator's own
/// browser, so it is a signed-in page. /display is opened on a TV that has no account, with a
/// screen's identifier in the URL as its only credential — and only a registered screen's identifier
/// may open it, never a public output's code, which is printed on a poster for everyone.
/// </summary>
[Collection(WebAppCollection.Name)]
public class ProjectorPageIntegrationTests
{
    private const string OrganizationId = "mock-org-sv";

    [Fact]
    public async Task LivePage_Anonymous_IsSentToSignIn()
    {
        using var app = new WebAppFixture();
        var client = app.CreateClient(new() { AllowAutoRedirect = false });

        var response = await client.GetAsync("/live?session=abcdef12");

        // Mock mode signs in at /mock-login, production at /login; both are a sign-in page that
        // remembers where the visitor was going.
        response.StatusCode.ShouldBe(HttpStatusCode.Redirect);
        response.Headers.Location!.AbsolutePath.ShouldEndWith("login");
        response.Headers.Location.Query.ShouldContain("ReturnUrl=%2Flive");
    }

    [Fact]
    public async Task DisplayPage_WithAPublicOutputsCode_DoesNotAcceptIt()
    {
        using var app = new WebAppFixture();
        var code = await AddOutputAsync(app, OutputKind.PublicQr);
        var client = app.CreateClient();

        var html = await client.GetStringAsync($"/display?id={code}");

        html.ShouldContain("not registered");
    }

    [Fact]
    public async Task DisplayPage_WithAScreensIdentifier_AcceptsIt()
    {
        using var app = new WebAppFixture();
        var code = await AddOutputAsync(app, OutputKind.Screen);
        var client = app.CreateClient();

        var html = await client.GetStringAsync($"/display?id={code}&name=Sanctuary");

        html.ShouldNotContain("not registered");
        html.ShouldContain("Sanctuary");
    }

    private static async Task<string> AddOutputAsync(WebAppFixture app, OutputKind kind)
    {
        using var scope = app.Services.CreateScope();
        var displays = scope.ServiceProvider.GetRequiredService<IRemoteDisplayService>();
        var caller = new CallerContext(WebAppFixture.MockUserId, UserRole.Admin, OrganizationId);
        var output = await displays.AddDisplayAsync(OrganizationId, "Output", caller, kind);
        return output.DisplayIdentifier;
    }
}
