using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The client version headers and the protocol floor: an app too old for the wire contract is
/// refused rather than served, and every device's version is recorded so the floor can be raised
/// against a measured distribution. See adr/0002-app-distribution-and-updates.md (24)–(25).
/// </summary>
[Collection(WebAppCollection.Name)]
public class ClientProtocolIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    [Fact]
    public async Task SyncCall_BelowTheProtocolFloor_IsRefusedWithUpgradeRequired()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app, "Gammal maskin");
        client.DefaultRequestHeaders.Add(SyncProtocol.ProtocolHeader, (SyncProtocol.Minimum - 1).ToString());

        // Act
        var response = await client.PostAsJsonAsync("/api/sync/pull", new { });

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.UpgradeRequired);
    }

    [Fact]
    public async Task SyncCall_WithAnUnparseableProtocolHeader_IsRefused()
    {
        // Arrange -- a header that is present but nonsense is a client bug, and reads as 0
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app, "Trasig maskin");
        client.DefaultRequestHeaders.Add(SyncProtocol.ProtocolHeader, "not-a-number");

        // Act
        var response = await client.PostAsJsonAsync("/api/sync/pull", new { });

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.UpgradeRequired);
    }

    [Fact]
    public async Task SyncCall_WithNoProtocolHeader_IsServed()
    {
        // Arrange -- callers predating the header never agreed to the contract, so they pass
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app, "Huvudlös maskin");

        // Act
        var response = await client.PostAsJsonAsync("/api/sync/pull", new { });

        // Assert
        response.StatusCode.ShouldNotBe(HttpStatusCode.UpgradeRequired);
    }

    [Fact]
    public async Task SyncCall_AtTheCurrentProtocol_IsServed()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app, "Aktuell maskin");
        client.DefaultRequestHeaders.Add(SyncProtocol.ProtocolHeader, SyncProtocol.Current.ToString());

        // Act
        var response = await client.PostAsJsonAsync("/api/sync/pull", new { });

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task DeviceCall_RecordsTheReportedVersionOnTheDevice()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app, "Rapporterande maskin");
        client.DefaultRequestHeaders.Add(SyncProtocol.VersionHeader, "1.2.0-beta.1");
        client.DefaultRequestHeaders.Add(SyncProtocol.ProtocolHeader, SyncProtocol.Current.ToString());

        // Act
        (await client.GetAsync("/api/me")).EnsureSuccessStatusCode();

        // Assert
        var device = await LoadDeviceAsync(app, "Rapporterande maskin");
        device.LastSeenVersion.ShouldBe("1.2.0-beta.1");
        device.LastSeenProtocol.ShouldBe(SyncProtocol.Current);
    }

    [Fact]
    public async Task DeviceCall_TruncatesAnOverlongReportedVersion()
    {
        // Arrange -- the header is client-controlled, and the column is bounded
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app, "Pratsam maskin");
        client.DefaultRequestHeaders.Add(SyncProtocol.VersionHeader, new string('9', 200));

        // Act
        (await client.GetAsync("/api/me")).EnsureSuccessStatusCode();

        // Assert
        var device = await LoadDeviceAsync(app, "Pratsam maskin");
        device.LastSeenVersion!.Length.ShouldBe(Shared.Models.DeviceToken.MaxVersionLength);
    }

    private static async Task<Shared.Models.DeviceToken> LoadDeviceAsync(WebAppFixture app, string deviceName)
    {
        await using var context = app.Services.GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        return await context.DeviceTokens.AsNoTracking().SingleAsync(t => t.Name == deviceName);
    }

    /// <summary>
    /// Signs in with a cookie, mints a device token through /app-login, and returns a client that
    /// carries it — the same route the MAUI app takes.
    /// </summary>
    private static async Task<HttpClient> CreateDeviceClientAsync(WebAppFixture app, string deviceName)
    {
        var cookies = new Microsoft.AspNetCore.Mvc.Testing.Handlers.CookieContainerHandler();
        var cookieClient = app.CreateDefaultClient(BaseAddress, cookies);
        (await cookieClient.GetAsync($"/mock-signin/{WebAppFixture.MockUserId}")).StatusCode
            .ShouldBe(HttpStatusCode.Redirect);

        var login = await cookieClient.GetAsync($"/app-login?device={Uri.EscapeDataString(deviceName)}");
        login.StatusCode.ShouldBe(HttpStatusCode.Redirect);
        var token = login.Headers.Location!.Fragment.Split("token=")[1].Split('&')[0];

        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
