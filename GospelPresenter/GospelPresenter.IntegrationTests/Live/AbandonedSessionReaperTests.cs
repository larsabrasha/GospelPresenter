using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.IntegrationTests.Helpers;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Web.Live;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Live;

/// <summary>
/// What happens to a device-owned session when the device never comes back.
///
/// Losing the connection freezes rather than stops, so a few seconds of bad wifi are invisible to a
/// congregation. The cost of that choice is a session nobody can end: a machine that was shut or
/// killed left its presentation running on this server, holding its screens and its public outputs.
/// The general four-hour session timeout is not the answer — it measures the last touch rather than
/// the last sign of life, and a visitor's phone reconnecting to a public output re-arms it.
///
/// These tests hold both halves of the rule: gone long enough is ended, and still connected is left
/// alone however quiet it has been.
/// </summary>
[Collection(WebAppCollection.Name)]
public class AbandonedSessionReaperTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    private const string OrganizationId = "mock-org-sv";
    private const string PresentationId = "sv-pres-main";

    private static readonly TimeSpan EndAfter = TimeSpan.FromMinutes(120);
    private static readonly DateTimeOffset Now = new(2026, 9, 5, 19, 0, 0, TimeSpan.Zero);

    [Fact]
    public void AnOwnerGoneLongerThanAllowed_IsAbandoned()
    {
        var session = Session("session-1", connected: false, lastSeen: Now - TimeSpan.FromMinutes(121));

        AbandonedSessionReaper.Abandoned([session], EndAfter, Now).ShouldBe(["session-1"]);
    }

    /// <summary>
    /// The whole point of freezing. A machine that drops off for a few minutes mid-service is coming
    /// back, and ending its session would drop the congregation's screens to the waiting screen.
    /// </summary>
    [Fact]
    public void AnOwnerGoneForALittleWhile_IsLeftFrozen()
    {
        var session = Session("session-1", connected: false, lastSeen: Now - TimeSpan.FromMinutes(20));

        AbandonedSessionReaper.Abandoned([session], EndAfter, Now).ShouldBeEmpty();
    }

    /// <summary>
    /// Quiet is not gone. A device sitting on one slide for hours reports nothing in between, and
    /// judging it by its last report would end a service that is running perfectly well.
    /// </summary>
    [Fact]
    public void AConnectedOwnerThatHasBeenQuietForHours_IsNotAbandoned()
    {
        var session = Session("session-1", connected: true, lastSeen: Now - TimeSpan.FromHours(6));

        AbandonedSessionReaper.Abandoned([session], EndAfter, Now).ShouldBeEmpty();
    }

    /// <summary>
    /// End to end against the real pipeline: a device presents, drops off for good, and the sweep
    /// ends its session as completely as its own Stop would have.
    /// </summary>
    [Fact]
    public async Task SweepingLongAfterTheDeviceWentAway_EndsTheSessionAndReleasesItsOutputs()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var registry = app.Services.GetRequiredService<MirroredSessionRegistry>();
        await WaitUntilAsync(() => registry.All().Count == 1, "the device should have registered");
        var sessionId = registry.All().Single().SessionId;

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        var displays = app.Services.GetRequiredService<RemoteDisplayState>();
        displays.EnableDisplay("screen-1", sessionId, "Stora salen");

        await connection.DisposeAsync();
        await WaitUntilAsync(() => !registry.IsOwnerOnline(sessionId), "the device should be marked offline");

        // A clock of its own rather than waiting out two hours of interval.
        app.Services.GetRequiredService<AbandonedSessionReaper>()
            .Sweep(DateTimeOffset.UtcNow + TimeSpan.FromHours(3));

        var state = app.Services.GetRequiredService<SharedAppState>();
        state.IsPresentationActive(sessionId).ShouldBeFalse();
        state.IsCcliReportedElsewhere(sessionId).ShouldBeFalse();
        registry.IsMirrored(sessionId).ShouldBeFalse();
        displays.IsDisplayConnectedToSession("screen-1", sessionId).ShouldBeFalse();
    }

    /// <summary>And a device that is still on the hub keeps its session, sweep or no sweep.</summary>
    [Fact]
    public async Task SweepingWhileTheDeviceIsStillConnected_LeavesTheSessionAlone()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var registry = app.Services.GetRequiredService<MirroredSessionRegistry>();
        await WaitUntilAsync(() => registry.All().Count == 1, "the device should have registered");
        var sessionId = registry.All().Single().SessionId;

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        app.Services.GetRequiredService<AbandonedSessionReaper>()
            .Sweep(DateTimeOffset.UtcNow + TimeSpan.FromHours(3));

        app.Services.GetRequiredService<SharedAppState>().IsPresentationActive(sessionId).ShouldBeTrue();
        registry.IsMirrored(sessionId).ShouldBeTrue();
    }

    private static MirroredSession Session(string sessionId, bool connected, DateTimeOffset lastSeen) =>
        new(sessionId, OrganizationId, "connection-1", "Kyrksalen", null, lastSeen, connected);

    /// <summary>The same way the desktop app mints one, as in LiveSessionHubIntegrationTests.</summary>
    private static async Task<string> IssueDeviceTokenAsync(WebAppFixture app)
    {
        var cookieClient = app.CreateDefaultClient(BaseAddress, new RedirectHandler(), new CookieContainerHandler());
        cookieClient.DefaultRequestHeaders.Add("Cookie", $"mock-user-id={WebAppFixture.MockUserId}");

        var response = await cookieClient.GetAsync("/app-login?device=Testmaskin");
        return await DeviceLogin.ReadTokenAsync(response);
    }

    private static HubConnection BuildConnection(WebAppFixture app, string token) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(BaseAddress, LiveSessionHubMethods.Path), options =>
            {
                options.Transports = HttpTransportType.LongPolling;
                options.HttpMessageHandlerFactory = _ => app.Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

    private static async Task<string> FirstSongItemIdAsync(WebAppFixture app)
    {
        using var scope = app.Services.CreateScope();
        var presentations = scope.ServiceProvider.GetRequiredService<IPresentationService>();
        var caller = new CallerContext(WebAppFixture.MockUserId, Shared.Models.UserRole.Admin, OrganizationId);

        var presentation = await presentations.GetPresentationByIdAsync(PresentationId, OrganizationId, caller);

        presentation.ShouldNotBeNull("the mock seed should contain the Sunday service presentation");
        return presentation.Items.OrderBy(i => i.SortOrder).First().Id;
    }

    private static async Task WaitUntilAsync(Func<bool> condition, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(25);
        }

        condition().ShouldBeTrue(because);
    }
}
