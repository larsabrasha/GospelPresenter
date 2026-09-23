using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GospelPresenter.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Shouldly;
using GospelPresenter.IntegrationTests.Helpers;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// Covers the device authentication flow end to end against the real pipeline: /app-login mints a
/// token into a custom-scheme handover page, the Bearer token then authenticates API requests
/// through the policy scheme, and a revoked token stops working — without disturbing cookie
/// sessions.
/// </summary>
[Collection(WebAppCollection.Name)]
public class DeviceTokenIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    private record TokenRow(string Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt);

    [Fact]
    public async Task AppLogin_HandsTheAppAFreshToken()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateCookieClientAsync(app);

        // Act
        var response = await client.GetAsync("/app-login?device=Testmaskin");

        // Assert -- a page hands over to the custom scheme, with the token in the fragment
        response.Content.Headers.ContentType!.MediaType.ShouldBe("text/html");
        var callback = await DeviceLogin.ReadCallbackAsync(response);
        callback.Scheme.ShouldBe("gospelpresenter");
        callback.Fragment.ShouldContain("token=gpdt_");
    }

    /// <summary>
    /// The desktop app's Test and Local builds register a scheme of their own, because an operating
    /// system routes a scheme to exactly one application — so a token minted here has to be handed
    /// over on the one the caller registered, not on the one the real app holds.
    ///
    /// One case per scheme the desktop app can be built with, so that dropping one from the
    /// server's allow-list breaks a test rather than an installed app's sign-in. The values are
    /// $(DesktopCallbackScheme) in GospelPresenter.Desktop/Directory.Build.GospelPresenter*.props.
    /// </summary>
    [Theory]
    [InlineData("gospelpresenter")]
    [InlineData("gospelpresenter-test")]
    [InlineData("gospelpresenter-local")]
    public async Task AppLogin_WithAnAllowedCallbackScheme_HandsOverOnIt(string scheme)
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateCookieClientAsync(app);

        // Act
        var response = await client.GetAsync($"/app-login?device=Testmaskin&callback_scheme={scheme}");

        // Assert
        var callback = await DeviceLogin.ReadCallbackAsync(response);
        callback.Scheme.ShouldBe(scheme);
    }

    /// <summary>
    /// The token travels in the fragment of the callback URL, so a scheme passed through unchecked
    /// would hand a working device token to whatever application the caller named.
    /// </summary>
    [Fact]
    public async Task AppLogin_WithAnUnknownCallbackScheme_IsRejected()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateCookieClientAsync(app);

        // Act
        var response = await client.GetAsync("/app-login?device=Testmaskin&callback_scheme=attacker");

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// Rejected before the token is minted, rather than after. A request that leaves a live device
    /// token behind that no callback ever collected is a credential nobody knows exists.
    /// </summary>
    [Fact]
    public async Task AppLogin_WithAnUnknownCallbackScheme_MintsNoToken()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);
        var token = await IssueTokenAsync(cookieClient, "Testmaskin");
        var deviceClient = CreateBearerClient(app, token);

        // Act
        await cookieClient.GetAsync("/app-login?device=Okänd&callback_scheme=attacker");

        // Assert
        var tokens = await deviceClient.GetFromJsonAsync<List<TokenRow>>("/api/device-tokens");
        tokens.ShouldNotBeNull();
        tokens.ShouldNotContain(t => t.Name == "Okänd");
    }

    [Fact]
    public async Task DeviceToken_AuthenticatesApiRequests()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);
        var token = await IssueTokenAsync(cookieClient, "Testmaskin");

        // Act
        var deviceClient = CreateBearerClient(app, token);
        var tokens = await deviceClient.GetFromJsonAsync<List<TokenRow>>("/api/device-tokens");

        // Assert
        tokens.ShouldNotBeNull();
        tokens.ShouldContain(t => t.Name == "Testmaskin");
    }

    [Fact]
    public async Task RevokedDeviceToken_IsRejected()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);
        var token = await IssueTokenAsync(cookieClient, "Testmaskin");

        var listed = await cookieClient.GetFromJsonAsync<List<TokenRow>>("/api/device-tokens");
        var id = listed!.Single(t => t.Name == "Testmaskin").Id;

        // Act
        (await cookieClient.DeleteAsync($"/api/device-tokens/{id}")).EnsureSuccessStatusCode();
        var response = await CreateBearerClient(app, token).GetAsync("/api/device-tokens");

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Me_WithADeviceToken_ReturnsTheProfileTheAppCaches()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);
        var token = await IssueTokenAsync(cookieClient, "Testmaskin");

        // Act
        var me = await CreateBearerClient(app, token)
            .GetFromJsonAsync<MeRow>("/api/me");

        // Assert
        me.ShouldNotBeNull();
        me.Id.ShouldBe(WebAppFixture.MockUserId);
        me.OrganizationId.ShouldBe("mock-org-sv");
        me.Role.ShouldNotBeNullOrEmpty();
        me.Name.ShouldNotBeNullOrEmpty();
    }

    private sealed record MeRow(string Id, string Name, string Email, string Role, string? OrganizationId, string? OrganizationName);

    /// <summary>
    /// The handover page closes itself once the app has its token, and learns that by polling
    /// /app-login/status. "Collected" has to mean the app authenticated with the token, not merely
    /// that it was minted — closing any earlier leaves nothing to fall back on if the hand-over
    /// failed.
    /// </summary>
    [Fact]
    public async Task AppLoginStatus_BeforeTheAppUsesTheToken_IsNotCollected()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);
        await IssueTokenAsync(cookieClient, "Testmaskin");
        var id = await TokenIdAsync(cookieClient, "Testmaskin");

        // Act
        var status = await cookieClient.GetFromJsonAsync<StatusRow>($"/app-login/status?id={id}");

        // Assert
        status.ShouldNotBeNull();
        status.Collected.ShouldBeFalse();
    }

    [Fact]
    public async Task AppLoginStatus_AfterTheAppUsesTheToken_IsCollected()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);
        var token = await IssueTokenAsync(cookieClient, "Testmaskin");
        var id = await TokenIdAsync(cookieClient, "Testmaskin");

        // Act -- what the app does the moment the callback arrives
        (await CreateBearerClient(app, token).GetAsync("/api/me")).EnsureSuccessStatusCode();
        var status = await cookieClient.GetFromJsonAsync<StatusRow>($"/app-login/status?id={id}");

        // Assert
        status.ShouldNotBeNull();
        status.Collected.ShouldBeTrue();
    }

    /// <summary>
    /// Scoped to the caller's own devices, so the endpoint cannot be used to learn anything about
    /// someone else's token — not even that it exists.
    /// </summary>
    [Fact]
    public async Task AppLoginStatus_ForAnotherUsersToken_IsNotFound()
    {
        // Arrange
        using var app = new WebAppFixture();
        var ownerClient = await CreateCookieClientAsync(app);
        await IssueTokenAsync(ownerClient, "Testmaskin");
        var id = await TokenIdAsync(ownerClient, "Testmaskin");
        var otherClient = await CreateCookieClientAsync(app, "mock-user-en");

        // Act
        var response = await otherClient.GetAsync($"/app-login/status?id={id}");

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    /// <summary>
    /// The page has to poll for the token it just minted and no other, or it would close on the
    /// strength of some earlier device's sign-in.
    /// </summary>
    [Fact]
    public async Task AppLogin_PollsForTheTokenItMinted()
    {
        // Arrange
        using var app = new WebAppFixture();
        var cookieClient = await CreateCookieClientAsync(app);

        // Act
        var html = await (await cookieClient.GetAsync("/app-login?device=Testmaskin")).Content.ReadAsStringAsync();
        var id = await TokenIdAsync(cookieClient, "Testmaskin");

        // Assert
        html.ShouldContain("app-login/status");
        html.ShouldContain(id);
    }

    private sealed record StatusRow(bool Collected);

    [Fact]
    public async Task UnknownDeviceToken_IsRejected()
    {
        // Arrange
        using var app = new WebAppFixture();

        // Act
        var response = await CreateBearerClient(app, "gpdt_not_a_real_token").GetAsync("/api/device-tokens");

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// Signs in as the seeded mock user. The /app-login response hands over to a custom scheme no
    /// HttpClient can follow, so the tests read the token out of the page it renders.
    /// </summary>
    private static async Task<HttpClient> CreateCookieClientAsync(WebAppFixture app, string userId = WebAppFixture.MockUserId)
    {
        var cookies = new CookieContainerHandler();
        var client = app.CreateDefaultClient(BaseAddress, cookies);

        var response = await client.GetAsync($"/mock-signin/{userId}");
        response.StatusCode.ShouldBe(HttpStatusCode.Redirect, "mock sign-in answers with a redirect carrying the cookie");
        cookies.Container.GetCookies(BaseAddress).Any(c => c.Name == ".AspNetCore.Cookies")
            .ShouldBeTrue("sign-in should have set an authentication cookie");

        return client;
    }

    private static async Task<string> IssueTokenAsync(HttpClient cookieClient, string deviceName)
    {
        var response = await cookieClient.GetAsync($"/app-login?device={Uri.EscapeDataString(deviceName)}");
        return await DeviceLogin.ReadTokenAsync(response);
    }

    private static async Task<string> TokenIdAsync(HttpClient cookieClient, string deviceName)
    {
        var listed = await cookieClient.GetFromJsonAsync<List<TokenRow>>("/api/device-tokens");
        return listed!.Single(t => t.Name == deviceName).Id;
    }

    private static HttpClient CreateBearerClient(WebAppFixture app, string token)
    {
        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
