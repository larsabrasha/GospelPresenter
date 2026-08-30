using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Shouldly;
using GospelPresenter.IntegrationTests.Helpers;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The whole device flow against the real pipeline: a token minted by /app-login pulls the
/// mock-seeded organisation through /api/sync/pull, paging included.
/// </summary>
[Collection(WebAppCollection.Name)]
public class SyncPullIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    [Fact]
    public async Task Pull_WithADeviceToken_ReturnsTheSeededOrganization()
    {
        // Arrange
        using var app = new WebAppFixture();
        var deviceClient = await CreateDeviceClientAsync(app);

        // Act -- page through a full sync
        var songs = new List<SyncSongDto>();
        string? cursor = null;
        SyncPullResponse? response;
        var pages = 0;
        do
        {
            var httpResponse = await deviceClient.PostAsJsonAsync("/api/sync/pull",
                new SyncPullRequest(null, cursor, Take: 50));
            httpResponse.StatusCode.ShouldBe(HttpStatusCode.OK);
            response = await httpResponse.Content.ReadFromJsonAsync<SyncPullResponse>();
            response.ShouldNotBeNull();
            songs.AddRange(response.Changes.Songs);
            cursor = response.NextCursor;
            pages++;
            pages.ShouldBeLessThan(100, "paging must terminate");
        } while (response.HasMore);

        // Assert -- the mock seeder gives the organisation a real song library
        songs.ShouldNotBeEmpty();
        response.RequiresFullResync.ShouldBeFalse();
        response.ServerWatermark.ShouldBeGreaterThan(DateTimeOffset.UtcNow.AddMinutes(-5));
    }

    [Fact]
    public async Task PullEditPushPull_RoundTripsAnOfflineEdit()
    {
        // Arrange -- a device pulls the library, as if going offline
        using var app = new WebAppFixture();
        var deviceClient = await CreateDeviceClientAsync(app);
        var first = await PullAllAsync(deviceClient);
        var song = first.Songs.First();

        // Act -- the "offline edit" is pushed with the pulled Version as its base
        var parts = first.SongParts.Where(p => p.SongId == song.Id).ToList();
        var arrangements = first.SongArrangements.Where(a => a.SongId == song.Id).ToList();
        var pushResponse = await deviceClient.PostAsJsonAsync("/api/sync/push", new SyncPushRequest
        {
            Songs =
            [
                new SyncSongPush(
                    song with { Name = "Redigerad offline" },
                    parts, arrangements,
                    BaseVersion: song.Version)
            ]
        });
        pushResponse.EnsureSuccessStatusCode();
        var push = await pushResponse.Content.ReadFromJsonAsync<SyncPushResponse>();

        // Assert -- applied cleanly, and the next incremental pull carries the rename
        push!.Results.Single().Outcome.ShouldBe(SyncPushOutcome.Applied);
        var second = await PullAllAsync(deviceClient, since: first.Watermark);
        second.Songs.Single(s => s.Id == song.Id).Name.ShouldBe("Redigerad offline");
    }

    [Fact]
    public async Task AnOutputCreatedOnADevice_MakesItsWatchPageResolve()
    {
        // The whole reason outputs are synced. A public output lives on the device that created it,
        // but the QR code on the wall points at the server, which resolves the code against its own
        // database — so before this, a code created on a desktop answered 404 to everyone who
        // scanned it.
        using var app = new WebAppFixture();
        var deviceClient = await CreateDeviceClientAsync(app);

        var pushResponse = await deviceClient.PostAsJsonAsync("/api/sync/push", new SyncPushRequest
        {
            RemoteDisplays =
            [
                new SyncRowPush<SyncRemoteDisplayDto>(
                    new SyncRemoteDisplayDto("display-offline", "qrs4321", "Foajén", OutputKind.PublicQr,
                        DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, Version: 0),
                    BaseVersion: null)
            ]
        });
        pushResponse.EnsureSuccessStatusCode();
        var push = await pushResponse.Content.ReadFromJsonAsync<SyncPushResponse>();
        push!.Results.Single().Outcome.ShouldBe(SyncPushOutcome.Applied);

        var visitor = app.CreateDefaultClient(BaseAddress);
        (await visitor.GetAsync("/watch/qrs4321")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AnOutputWhoseCodeIsAlreadyTaken_IsGivenANewOne()
    {
        // Codes are unique across every organisation and a device offline mints its own, so two
        // machines can arrive at the same seven characters. The server keeps the one it issued and
        // sends the newcomer a replacement, which its next pull adopts.
        using var app = new WebAppFixture();
        var deviceClient = await CreateDeviceClientAsync(app);

        async Task<SyncPushResult> PushAsync(string id, string code)
        {
            var response = await deviceClient.PostAsJsonAsync("/api/sync/push", new SyncPushRequest
            {
                RemoteDisplays =
                [
                    new SyncRowPush<SyncRemoteDisplayDto>(
                        new SyncRemoteDisplayDto(id, code, "Foajén", OutputKind.PublicQr,
                            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, Version: 0),
                        BaseVersion: null)
                ]
            });
            response.EnsureSuccessStatusCode();
            return (await response.Content.ReadFromJsonAsync<SyncPushResponse>())!.Results.Single();
        }

        (await PushAsync("display-first", "qrs9876")).Outcome.ShouldBe(SyncPushOutcome.Applied);
        var second = await PushAsync("display-second", "qrs9876");

        second.Outcome.ShouldBe(SyncPushOutcome.Applied);
        second.Warning.ShouldNotBeNull();

        await using var scope = app.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<PresentationContext>>();
        await using var db = await factory.CreateDbContextAsync();
        var codes = await db.RemoteDisplays
            .Where(d => d.Id == "display-first" || d.Id == "display-second")
            .ToDictionaryAsync(d => d.Id, d => d.DisplayIdentifier);

        codes["display-first"].ShouldBe("qrs9876");
        codes["display-second"].ShouldNotBe("qrs9876");
    }

    [Fact]
    public async Task Pull_WithoutAuthentication_IsRejected()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = app.CreateDefaultClient(BaseAddress);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "gpdt_bogus");

        // Act
        var response = await client.PostAsJsonAsync("/api/sync/pull", new SyncPullRequest(null, null));

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    private sealed record PulledData(
        List<SyncSongDto> Songs,
        List<SyncSongPartDto> SongParts,
        List<SyncSongArrangementDto> SongArrangements,
        DateTimeOffset Watermark);

    private static async Task<PulledData> PullAllAsync(HttpClient deviceClient, DateTimeOffset? since = null)
    {
        var songs = new List<SyncSongDto>();
        var parts = new List<SyncSongPartDto>();
        var arrangements = new List<SyncSongArrangementDto>();
        string? cursor = null;
        SyncPullResponse response;
        do
        {
            var httpResponse = await deviceClient.PostAsJsonAsync("/api/sync/pull",
                new SyncPullRequest(since, cursor));
            httpResponse.EnsureSuccessStatusCode();
            response = (await httpResponse.Content.ReadFromJsonAsync<SyncPullResponse>())!;
            songs.AddRange(response.Changes.Songs);
            parts.AddRange(response.Changes.SongParts);
            arrangements.AddRange(response.Changes.SongArrangements);
            cursor = response.NextCursor;
        } while (response.HasMore);

        return new PulledData(songs, parts, arrangements, response.ServerWatermark);
    }

    private static async Task<HttpClient> CreateDeviceClientAsync(WebAppFixture app)
    {
        var cookies = new CookieContainerHandler();
        var cookieClient = app.CreateDefaultClient(BaseAddress, cookies);
        (await cookieClient.GetAsync($"/mock-signin/{WebAppFixture.MockUserId}"))
            .StatusCode.ShouldBe(HttpStatusCode.Redirect);

        var login = await cookieClient.GetAsync("/app-login?device=Synktest");
        var token = await DeviceLogin.ReadTokenAsync(login);

        var deviceClient = app.CreateDefaultClient(BaseAddress);
        deviceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return deviceClient;
    }
}
