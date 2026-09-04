using System.Net;
using System.Net.Http.Headers;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.IntegrationTests.Helpers;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// The doorbell against the real pipeline: a device token is minted the way the desktop app mints
/// one, the change hub is reached over it, and an ordinary edit made through the ordinary service
/// reaches that device.
///
/// The addressing is what matters here. An announcement that goes everywhere costs strangers a sync
/// for nothing; one that goes nowhere leaves the change five minutes late, which is the whole thing
/// this was built to fix.
///
/// Both tests wait for quiet before acting. The fixture seeds mock data for two organisations as it
/// starts, and that seeding announces exactly as any other write does — without the wait, the
/// positive test could pass on somebody else's announcement and the negative one could fail on it.
///
/// Same limitation as the live hub's tests: the test server has no sockets, so the transport is long
/// polling. What is exercised is the part both transports share and that the server reads — the
/// Authorization header carrying the device token.
/// </summary>
[Collection(WebAppCollection.Name)]
public class OrganizationChangesHubIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    private const string SwedishOrganizationId = "mock-org-sv";
    private const string EnglishOrganizationId = "mock-org-en";
    private const string SwedishPresentationId = "sv-pres-main";

    [Fact]
    public async Task ADeviceOnTheHub_IsToldWhenItsOwnOrganizationChanges()
    {
        using var app = new WebAppFixture();
        await using var connection = BuildConnection(app, await IssueDeviceTokenAsync(app));

        var announcements = 0;
        connection.On(OrganizationChangesHubMethods.OrganizationChanged,
            () => Interlocked.Increment(ref announcements));
        await connection.StartAsync();
        var quiet = await WaitForQuietAsync(() => Volatile.Read(ref announcements));

        // An ExecuteUpdate path, and therefore one that announces by hand — the case most likely to
        // be forgotten, so the one worth driving from end to end.
        await RenameSwedishPresentationAsync(app, "Söndagsgudstjänst");

        await WaitUntilAsync(() => Volatile.Read(ref announcements) > quiet,
            "the device should have been told about the edit in its own organisation");
    }

    [Fact]
    public async Task ADeviceOnTheHub_HearsNothingAboutAnotherOrganization()
    {
        using var app = new WebAppFixture();
        await using var connection = BuildConnection(app, await IssueDeviceTokenAsync(app));

        var announcements = 0;
        connection.On(OrganizationChangesHubMethods.OrganizationChanged,
            () => Interlocked.Increment(ref announcements));
        await connection.StartAsync();
        var quiet = await WaitForQuietAsync(() => Volatile.Read(ref announcements));

        // Someone in the other organisation edits one of their presentations.
        await RenameEnglishPresentationAsync(app, "Renamed elsewhere");

        // Several times the notifier's coalescing window.
        await Task.Delay(TimeSpan.FromSeconds(2));
        Volatile.Read(ref announcements).ShouldBe(quiet,
            "a device was told about an edit in an organisation it has nothing to do with");

        // And then the same connection is shown to be listening at all, so that the silence above
        // means "addressed correctly" rather than "nothing works".
        await RenameSwedishPresentationAsync(app, "Söndagsgudstjänst");
        await WaitUntilAsync(() => Volatile.Read(ref announcements) > quiet,
            "the connection had stopped listening, so the assertion above proved nothing");
    }

    /// <summary>
    /// The doorbell has to be exempt from the stored-language redirect, the way the live hub and
    /// every /api path already are. Neither hub lives under /api — they are hubs — and without the
    /// exemption the first negotiate is answered with a redirect to itself; HttpClient follows it,
    /// drops the Authorization header on the way, and the device is told 401.
    ///
    /// Where the live hub pays one retry for that, the doorbell pays everything: a 401 there means
    /// a revoked token, so <c>OrganizationChangesClient</c> stops for good and the device is left
    /// with the five-minute pull until someone restarts it. Every start has a fresh cookie
    /// container, so it happens every time.
    /// </summary>
    [Fact]
    public async Task Negotiate_ForAUserWithAStoredLanguage_IsNotRedirected()
    {
        using var app = new WebAppFixture();
        await app.SetPreferredLanguageAsync("sv");
        var token = await IssueDeviceTokenAsync(app);

        // No cookie container and no redirect following: exactly what SignalR's first negotiate
        // looks like, and the only way to see the redirect rather than its recovery.
        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsync(
            $"{OrganizationChangesHubMethods.Path}/negotiate?negotiateVersion=1", null);

        response.StatusCode.ShouldBe(HttpStatusCode.OK,
            "a device token on the doorbell must reach the hub, not a culture redirect");
    }

    /// <summary>
    /// Waits until the count has stopped moving, and returns it. Also covers the join race: the
    /// client's <c>StartAsync</c> can return before the server has finished
    /// <c>OnConnectedAsync</c> — the handshake response is written first — so an announcement made
    /// in that gap goes to a group this connection has not joined yet.
    /// </summary>
    private static async Task<int> WaitForQuietAsync(Func<int> count)
    {
        var last = count();
        var still = 0;

        for (var i = 0; i < 75 && still < 5; i++)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(200));
            var now = count();
            still = now == last ? still + 1 : 0;
            last = now;
        }

        return last;
    }

    private static async Task WaitUntilAsync(Func<bool> condition, string because)
    {
        for (var i = 0; i < 100 && !condition(); i++)
            await Task.Delay(TimeSpan.FromMilliseconds(100));

        condition().ShouldBeTrue(because);
    }

    private static async Task RenameSwedishPresentationAsync(WebAppFixture app, string name)
    {
        using var scope = app.Services.CreateScope();
        var presentations = scope.ServiceProvider.GetRequiredService<IPresentationService>();

        await presentations.RenamePresentationAsync(
            SwedishOrganizationId, SwedishPresentationId, name, CallerFor(SwedishOrganizationId));
    }

    private static async Task RenameEnglishPresentationAsync(WebAppFixture app, string name)
    {
        using var scope = app.Services.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<PresentationContext>>();

        string presentationId;
        await using (var context = await factory.CreateDbContextAsync())
        {
            presentationId = await context.Presentations
                .Where(p => p.OrganizationId == EnglishOrganizationId && !p.IsTemplate)
                .Select(p => p.Id)
                .FirstAsync();
        }

        var presentations = scope.ServiceProvider.GetRequiredService<IPresentationService>();
        await presentations.RenamePresentationAsync(
            EnglishOrganizationId, presentationId, name, CallerFor(EnglishOrganizationId));
    }

    private static CallerContext CallerFor(string organizationId) =>
        new(WebAppFixture.MockUserId, UserRole.Admin, organizationId);

    private static HubConnection BuildConnection(WebAppFixture app, string? token) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(BaseAddress, OrganizationChangesHubMethods.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => app.Server.CreateHandler();
                if (token is not null)
                    options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

    private static async Task<string> IssueDeviceTokenAsync(WebAppFixture app)
    {
        var cookieClient = app.CreateDefaultClient(BaseAddress, new RedirectHandler(), new CookieContainerHandler());
        cookieClient.DefaultRequestHeaders.Add("Cookie", $"mock-user-id={WebAppFixture.MockUserId}");

        var response = await cookieClient.GetAsync("/app-login?device=Testmaskin");
        return await DeviceLogin.ReadTokenAsync(response);
    }
}
