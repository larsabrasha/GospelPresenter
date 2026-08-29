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
    private static async Task<HttpClient> CreateCookieClientAsync(WebAppFixture app)
    {
        var cookies = new CookieContainerHandler();
        var client = app.CreateDefaultClient(BaseAddress, cookies);

        var response = await client.GetAsync($"/mock-signin/{WebAppFixture.MockUserId}");
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

    private static HttpClient CreateBearerClient(WebAppFixture app, string token)
    {
        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
