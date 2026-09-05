using System.Net;
using System.Net.Http.Headers;
using System.Text.Encodings.Web;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.IntegrationTests.Helpers;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Models;
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
/// Drives the live session hub against the real application pipeline: a device token is minted the
/// way the desktop app mints one, the hub is reached over that token, and what the device reports
/// turns into ordinary live state that the public outputs and remote mode already know how to read.
///
/// One thing this deliberately cannot prove. The test server has no sockets, so the connection runs
/// over long polling; the WebSocket handshake a real desktop client performs is not exercised here.
/// What is exercised is the part both transports share and that the server actually reads — the
/// Authorization header carrying the device token.
/// </summary>
[Collection(WebAppCollection.Name)]
public class LiveSessionHubIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    private const string OrganizationId = "mock-org-sv";
    private const string PresentationId = "sv-pres-main";

    [Fact]
    public async Task ADeviceReportingASong_TurnsIntoALiveSlideOnTheServer()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();

        var sessionId = await WaitForRegisteredSessionAsync(app);
        var itemId = await FirstSongItemIdAsync(app);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, itemId, 0, null));

        var state = app.Services.GetRequiredService<SharedAppState>();

        state.IsPresentationActive(sessionId).ShouldBeTrue();
        state.GetSessionOrganizationId(sessionId).ShouldBe(OrganizationId);
        state.IsRemoteControlEnabled(sessionId).ShouldBeTrue();

        var slide = state.GetLiveSlide(sessionId);
        slide.Status.ShouldBe(LiveSlideStatus.ShowingPresentation);
        slide.ProjectItemId.ShouldBe(itemId);
        slide.ItemPartIndex.ShouldBe(0);
        // Rebuilt from the server's own copy, never shipped: the device sent no text at all.
        slide.Text.ShouldNotBeNullOrWhiteSpace();
        slide.Theme.ShouldNotBeNull();
    }

    [Fact]
    public async Task ADeviceSession_IsExemptFromTheServersCcliCounting()
    {
        // The device counts its own usage locally and syncs it up. Counting it here as well would
        // report every song of every service twice.
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        app.Services.GetRequiredService<SharedAppState>()
            .IsCcliReportedElsewhere(sessionId).ShouldBeTrue();
    }

    [Fact]
    public async Task ADeviceThatDisconnects_LeavesTheSlideUpButIsMarkedOffline()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);
        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        await connection.DisposeAsync();

        var registry = app.Services.GetRequiredService<MirroredSessionRegistry>();
        await WaitUntilAsync(() => !registry.IsOwnerOnline(sessionId),
            "the registry should notice the device is gone");

        // The congregation keeps the slide it has. Only the owner ends a session.
        var state = app.Services.GetRequiredService<SharedAppState>();
        state.IsPresentationActive(sessionId).ShouldBeTrue();
        state.GetLiveSlide(sessionId).Text.ShouldNotBeNullOrWhiteSpace();
    }

    /// <summary>
    /// Why a remote controller cannot stop a mirrored presentation, shown against the real pipeline.
    ///
    /// A controller only ever reaches this server's live state. Taking the session out of it looks
    /// like a stop for as long as it takes the device to report its next change — which is seconds,
    /// and which puts the session straight back, because a report is absolute and says the device is
    /// presenting. The projector never stopped at any point. Compare
    /// EndingTheSession_ClearsItAndTheCcliExemptionWithIt below, which is the owner doing it, and
    /// which sticks.
    /// </summary>
    [Fact]
    public async Task ADeactivationOnThisServer_IsUndoneByTheOwnersNextReport()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);
        var itemId = await FirstSongItemIdAsync(app);
        var state = app.Services.GetRequiredService<SharedAppState>();

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, itemId, 0, null));
        state.IsPresentationActive(sessionId).ShouldBeTrue();

        // All a controller's Stop button ever reached.
        state.DeactivatePresentation(sessionId);
        state.IsPresentationActive(sessionId).ShouldBeFalse();

        // The operator on the device moves to the next verse, and the report comes up as usual.
        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, itemId, 1, null));

        state.IsPresentationActive(sessionId).ShouldBeTrue();
        state.GetLiveSlide(sessionId).ItemPartIndex.ShouldBe(1);
    }

    [Fact]
    public async Task EndingTheSession_ClearsItAndTheCcliExemptionWithIt()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);
        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        await connection.InvokeAsync(LiveSessionHubMethods.EndSession);

        var state = app.Services.GetRequiredService<SharedAppState>();
        state.IsPresentationActive(sessionId).ShouldBeFalse();
        // The next session under this id may well be an ordinary browser one.
        state.IsCcliReportedElsewhere(sessionId).ShouldBeFalse();
        app.Services.GetRequiredService<MirroredSessionRegistry>().IsMirrored(sessionId).ShouldBeFalse();
    }

    [Fact]
    public async Task APublicOutputBoundToADeviceSession_RendersWhatTheDeviceReported()
    {
        // The whole point of rebuilding the slide server-side: a visitor's phone is served by this
        // host and could never fetch anything from the operator's machine.
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        const string outputCode = "abc1234";
        app.Services.GetRequiredService<RemoteDisplayState>().EnableDisplay(outputCode, sessionId);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        var broadcaster = app.Services.GetRequiredService<PublicOutputBroadcaster>();
        var evt = await broadcaster.GetCurrentEventAsync(outputCode);

        evt.Type.ShouldBe(PublicOutputEventType.Slide);
        evt.Html.ShouldNotBeNull();

        // Encoded before comparing: the renderer escapes non-ASCII, so a Swedish lyric reaches the
        // page as numeric entities rather than as the letters the live state holds.
        var expected = app.Services.GetRequiredService<SharedAppState>().GetLiveSlide(sessionId).Text;
        evt.Html.ShouldContain(HtmlEncoder.Default.Encode(expected!.Split('\n')[0]));
    }

    [Fact]
    public async Task APublicOutputFollowsTheDeviceToABlackScreen()
    {
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        const string outputCode = "abc1235";
        app.Services.GetRequiredService<RemoteDisplayState>().EnableDisplay(outputCode, sessionId);

        var itemId = await FirstSongItemIdAsync(app);
        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, true, itemId, 0, null));

        var broadcaster = app.Services.GetRequiredService<PublicOutputBroadcaster>();
        (await broadcaster.GetCurrentEventAsync(outputCode)).Type.ShouldBe(PublicOutputEventType.Idle);

        // And back again — the selection survived the blackout.
        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, itemId, 0, null));

        (await broadcaster.GetCurrentEventAsync(outputCode)).Type.ShouldBe(PublicOutputEventType.Slide);
    }

    [Fact]
    public async Task AnOutputTheDeviceSwitchedOn_IsBoundHereWithoutAnyoneTouchingThisServer()
    {
        // The half that was missing. The device owns the binding between an output and its session,
        // but a visitor only ever reaches this server's — so the owner reports which outputs it
        // switched on, and the projector binds them here.
        using var app = new WebAppFixture();
        var outputCode = await SeedPublicOutputAsync(app, "Foajén");
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null,
            EnabledOutputs: outputCode));

        var broadcaster = app.Services.GetRequiredService<PublicOutputBroadcaster>();
        broadcaster.GetBroadcastingSessionId(outputCode).ShouldBe(sessionId);
        (await broadcaster.GetCurrentEventAsync(outputCode)).Type.ShouldBe(PublicOutputEventType.Slide);
    }

    [Fact]
    public async Task AnOutputTheDeviceSwitchedOff_StopsBeingFedHere()
    {
        using var app = new WebAppFixture();
        var outputCode = await SeedPublicOutputAsync(app, "Foajén");
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);
        var itemId = await FirstSongItemIdAsync(app);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, itemId, 0, null, EnabledOutputs: outputCode));

        var broadcaster = app.Services.GetRequiredService<PublicOutputBroadcaster>();
        broadcaster.GetBroadcastingSessionId(outputCode).ShouldBe(sessionId, "it has to be on before it can go off");

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, itemId, 0, null, EnabledOutputs: ""));

        broadcaster.GetBroadcastingSessionId(outputCode).ShouldBeNull();
    }

    [Fact]
    public async Task AnOwnerThatSaysNothingAboutOutputs_LeavesThemAsTheyAre()
    {
        // A build from before outputs travelled. Null is silence, not "none": reading it as a
        // request to switch everything off would take the congregation's screen away mid-service.
        using var app = new WebAppFixture();
        var outputCode = await SeedPublicOutputAsync(app, "Foajén");
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);
        app.Services.GetRequiredService<RemoteDisplayState>().EnableDisplay(outputCode, sessionId);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));

        app.Services.GetRequiredService<PublicOutputBroadcaster>()
            .GetBroadcastingSessionId(outputCode).ShouldBe(sessionId);
    }

    [Fact]
    public async Task EndingTheSession_ReleasesTheOutputsItHeld()
    {
        // Distinct from the connection dropping, which leaves them bound on purpose so a public
        // screen freezes on its slide rather than falling to the waiting screen over bad wifi.
        using var app = new WebAppFixture();
        var outputCode = await SeedPublicOutputAsync(app, "Foajén");
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        // Bound here rather than through a report, so this measures the ending and nothing else.
        var displays = app.Services.GetRequiredService<RemoteDisplayState>();
        displays.EnableDisplay(outputCode, sessionId);

        await connection.InvokeAsync(LiveSessionHubMethods.ReportState, new MirroredSessionState(
            PresentationId, "Söndagsgudstjänst", true, false, await FirstSongItemIdAsync(app), 0, null));
        await connection.InvokeAsync(LiveSessionHubMethods.EndSession);

        displays.IsDisplayConnected(outputCode).ShouldBeFalse();
    }

    [Fact]
    public async Task TheHub_RefusesAConnectionWithoutADeviceToken()
    {
        using var app = new WebAppFixture();
        await using var connection = BuildConnection(app, token: null);

        // A cookie session already presents through its own circuit; there is nothing here for it.
        await Should.ThrowAsync<Exception>(connection.StartAsync());
    }

    [Fact]
    public async Task TheSessionIdTheServerRegisters_IsDerivedFromTheDeviceItAuthenticatedAs()
    {
        // The client is never asked which session it is. Both ends derive the same id from the
        // device token, which is what stops one device from claiming another's session.
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        var deviceId = app.Services.GetRequiredService<MirroredSessionRegistry>()
            .All().Single().SessionId;

        sessionId.ShouldBe(deviceId);
        sessionId.Length.ShouldBe(12);
    }

    [Fact]
    public async Task TheHub_LearnsWhatTheDeviceIsCalled()
    {
        // So a controller looking at two live sessions of the same presentation can say which
        // machine it is about to drive. The name is the one the user gave the device when they
        // registered it -- the same one they see in the device list when revoking it.
        using var app = new WebAppFixture();
        var token = await IssueDeviceTokenAsync(app);
        await using var connection = BuildConnection(app, token);

        await connection.StartAsync();
        var sessionId = await WaitForRegisteredSessionAsync(app);

        app.Services.GetRequiredService<MirroredSessionRegistry>()
            .OwnerName(sessionId).ShouldBe("Testmaskin");
    }

    // ---------- helpers ----------

    private static HubConnection BuildConnection(WebAppFixture app, string? token) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(BaseAddress, LiveSessionHubMethods.Path), options =>
            {
                // The test server speaks HTTP in-process and has no sockets, so the transport is
                // pinned to long polling. The Authorization header is the same either way, and it
                // is the only thing the server's device token handler reads.
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

    /// <summary>Creates a public output through the real service and returns its watch code.</summary>
    private static async Task<string> SeedPublicOutputAsync(WebAppFixture app, string name)
    {
        using var scope = app.Services.CreateScope();
        var displays = scope.ServiceProvider.GetRequiredService<IRemoteDisplayService>();
        var caller = new CallerContext(WebAppFixture.MockUserId, Shared.Models.UserRole.Admin, OrganizationId);

        var output = await displays.AddDisplayAsync(OrganizationId, name, caller, OutputKind.PublicQr);
        return output.DisplayIdentifier;
    }

    private static async Task<string> FirstSongItemIdAsync(WebAppFixture app)
    {
        // A scope of its own: IPresentationService is scoped, as it is for every request that uses it.
        using var scope = app.Services.CreateScope();
        var presentations = scope.ServiceProvider.GetRequiredService<IPresentationService>();
        var caller = new CallerContext(WebAppFixture.MockUserId, Shared.Models.UserRole.Admin, OrganizationId);

        var presentation = await presentations.GetPresentationByIdAsync(PresentationId, OrganizationId, caller);

        presentation.ShouldNotBeNull("the mock seed should contain the Sunday service presentation");
        return presentation.Items.OrderBy(i => i.SortOrder).First().Id;
    }

    /// <summary>
    /// The hub has to be exempt from the stored-language redirect, the way every /api path already
    /// is. It is not under /api — it is a hub — and without the exemption the first negotiate of
    /// every presentation is answered with a redirect to itself; HttpClient follows it, drops the
    /// Authorization header on the way, and the device is told 401. It recovers on the retry a
    /// second later, which is exactly why nothing noticed.
    /// </summary>
    [Fact]
    public async Task Negotiate_ForAUserWithAStoredLanguage_IsNotRedirected()
    {
        using var app = new WebAppFixture();
        await StorePreferredLanguageAsync(app);
        var token = await IssueDeviceTokenAsync(app);

        // No cookie container and no redirect following: exactly what SignalR's first negotiate
        // looks like, and the only way to see the redirect rather than its recovery.
        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsync("/hubs/live-session/negotiate?negotiateVersion=1", null);

        response.StatusCode.ShouldBe(HttpStatusCode.OK,
            "a device token on the hub must reach the hub, not a culture redirect");
    }

    private static async Task StorePreferredLanguageAsync(WebAppFixture app)
    {
        using var scope = app.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<IUserService>();
        var caller = new CallerContext(WebAppFixture.MockUserId, Shared.Models.UserRole.Admin, OrganizationId);

        await users.SetUserSettingAsync(WebAppFixture.MockUserId, UserSetting.PreferredLanguage, "sv", caller);
    }

    private static async Task<string> WaitForRegisteredSessionAsync(WebAppFixture app)
    {
        var registry = app.Services.GetRequiredService<MirroredSessionRegistry>();
        await WaitUntilAsync(() => registry.All().Count == 1,
            "the device should have registered a live session on connect");
        return registry.All().Single().SessionId;
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
