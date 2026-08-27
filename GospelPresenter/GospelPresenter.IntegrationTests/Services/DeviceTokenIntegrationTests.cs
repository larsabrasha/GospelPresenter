using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GospelPresenter.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// Covers the device authentication flow end to end against the real pipeline: /app-login mints a
/// token into a custom-scheme redirect, the Bearer token then authenticates API requests through
/// the policy scheme, and a revoked token stops working — without disturbing cookie sessions.
/// </summary>
[Collection(WebAppCollection.Name)]
public class DeviceTokenIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    private record TokenRow(string Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt);

    [Fact]
    public async Task AppLogin_RedirectsToTheAppWithAFreshToken()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateCookieClientAsync(app);

        // Act
        var response = await client.GetAsync("/app-login?device=Testmaskin");

        // Assert -- the token travels in the fragment of a custom-scheme redirect
        response.StatusCode.ShouldBe(HttpStatusCode.Redirect);
        var location = response.Headers.Location!;
        location.Scheme.ShouldBe("gospelpresenter");
        location.Fragment.ShouldContain("token=gpdt_");
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
    /// Signs in as the seeded mock user without following redirects: the /app-login response is a
    /// redirect to a custom scheme no HttpClient can follow, so the tests read Location directly.
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
        response.StatusCode.ShouldBe(HttpStatusCode.Redirect);

        // The fragment is "#token=...&user_id=...&organization_id=..."
        var fragment = response.Headers.Location!.Fragment.TrimStart('#');
        var token = fragment.Split('&')
            .Select(pair => pair.Split('=', 2))
            .Single(pair => pair[0] == "token")[1];
        return Uri.UnescapeDataString(token);
    }

    private static HttpClient CreateBearerClient(WebAppFixture app, string token)
    {
        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
