using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shouldly;
using GospelPresenter.IntegrationTests.Helpers;

namespace GospelPresenter.IntegrationTests.Services;

/// <summary>
/// The sync side channels through the real pipeline: Bible verse download (with gzip), the CCLI
/// offline queue, and the media blob upload with its organisation boundary.
/// </summary>
[Collection(WebAppCollection.Name)]
public class SyncSideChannelIntegrationTests
{
    private static readonly Uri BaseAddress = new("https://localhost/");

    [Fact]
    public async Task BibleDownload_ReturnsGzippedVerses()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app);
        var (bibleId, orgId) = await GetSeededBibleAsync(app);
        orgId.ShouldBe("mock-org-sv", "the device client is signed in to the Swedish mock org");

        client.DefaultRequestHeaders.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        // Act
        var response = await client.GetAsync($"/api/sync/bibles/{bibleId}");

        // Assert -- HttpClient decompresses nothing by default, so the encoding header is visible
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentEncoding.ShouldContain("gzip");
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes.Length.ShouldBeGreaterThan(0);

        await using var gzip = new System.IO.Compression.GZipStream(
            new MemoryStream(bytes), System.IO.Compression.CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        var json = await reader.ReadToEndAsync();
        json.TrimStart().ShouldStartWith("[");
    }

    [Fact]
    public async Task CcliReports_RecordOnceAndAreIdempotent()
    {
        // Arrange
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app);
        await EnableCcliCollectionAsync(app);

        var entries = new[]
        {
            new CcliSyncEntry("song-1", "Amazing Grace", "12345", null, "Gudstjänst", new DateOnly(2026, 8, 23)),
        };

        // Act
        var first = await client.PostAsJsonAsync("/api/sync/ccli-reports", entries);
        var second = await client.PostAsJsonAsync("/api/sync/ccli-reports", entries);

        // Assert
        (await first.Content.ReadFromJsonAsync<RecordedResponse>())!.Recorded.ShouldBe(1);
        (await second.Content.ReadFromJsonAsync<RecordedResponse>())!.Recorded.ShouldBe(0);
    }

    [Fact]
    public async Task MediaUpload_AcceptsOwnOrganizationsKeyAndRejectsOthers()
    {
        // Arrange
        using var app = new StorageWebAppFixture();
        var client = await CreateDeviceClientAsync(app);
        var imageId = Guid.NewGuid().ToString();

        // Act
        var own = await client.PutAsync(
            $"/api/sync/media/org/mock-org-sv/images/{imageId}/full",
            new ByteArrayContent(TinyPng));
        var foreign = await client.PutAsync(
            $"/api/sync/media/org/someone-else/images/{imageId}/full",
            new ByteArrayContent(TinyPng));

        // Assert
        own.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        foreign.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        app.Storage.Keys.ShouldBe([$"org/mock-org-sv/images/{imageId}/full"]);
    }

    [Fact]
    public async Task MediaUpload_WithoutObjectStorageConfigured_AnswersServiceUnavailable()
    {
        // Arrange -- plain mock mode has no S3
        using var app = new WebAppFixture();
        var client = await CreateDeviceClientAsync(app);

        // Act
        var response = await client.PutAsync(
            $"/api/sync/media/org/mock-org-sv/images/{Guid.NewGuid()}/full",
            new ByteArrayContent(TinyPng));

        // Assert
        response.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    }

    /// <summary>
    /// The stored type is what every media endpoint serves the blob back under, from this origin.
    /// It therefore comes from the bytes, not from the request: a device claiming text/html for a
    /// script under an image key must be turned away, whatever header it sends, and a real image
    /// must be stored under the type it actually is even when the header says otherwise.
    /// </summary>
    [Fact]
    public async Task MediaUpload_StoresTheTypeTheBytesAre_NotTheTypeTheRequestClaims()
    {
        // Arrange
        using var app = new StorageWebAppFixture();
        var client = await CreateDeviceClientAsync(app);
        var imageId = Guid.NewGuid().ToString();

        var html = new ByteArrayContent("<script>alert(1)</script>"u8.ToArray());
        html.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/html");
        var mislabelledPng = new ByteArrayContent(TinyPng);
        mislabelledPng.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/html");

        // Act
        var scriptUnderImageKey = await client.PutAsync($"/api/sync/media/org/mock-org-sv/images/{imageId}/full", html);
        var pngCalledHtml = await client.PutAsync($"/api/sync/media/org/mock-org-sv/images/{imageId}/thumb", mislabelledPng);

        // Assert
        scriptUnderImageKey.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        pngCalledHtml.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        app.Storage.Keys.ShouldBe([$"org/mock-org-sv/images/{imageId}/thumb"]);
        app.Storage.ContentTypeOf($"org/mock-org-sv/images/{imageId}/thumb").ShouldBe("image/png");
    }

    /// <summary>An 8-byte PNG signature followed by nothing: enough to be recognised as a PNG.</summary>
    private static readonly byte[] TinyPng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    private sealed record RecordedResponse(int Recorded);

    /// <summary>Mock mode has no S3; this fixture swaps in an in-memory store so uploads can be observed.</summary>
    private sealed class StorageWebAppFixture : WebAppFixture
    {
        public InMemoryObjectStorageService Storage { get; } = new();

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IObjectStorageService>();
                services.AddSingleton<IObjectStorageService>(Storage);
            });
        }
    }

    private sealed class InMemoryObjectStorageService : IObjectStorageService
    {
        private readonly Dictionary<string, (byte[] Data, string ContentType)> blobs = [];

        public IReadOnlyCollection<string> Keys => blobs.Keys;

        public string ContentTypeOf(string key) => blobs[key].ContentType;

        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default)
        {
            blobs[key] = (data, contentType);
            return Task.CompletedTask;
        }

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult<(Stream, string)?>(blobs.TryGetValue(key, out var blob)
                ? (new MemoryStream(blob.Data), blob.ContentType)
                : null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default)
        {
            blobs.Remove(key);
            return Task.CompletedTask;
        }

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
        {
            foreach (var key in blobs.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList())
                blobs.Remove(key);
            return Task.CompletedTask;
        }

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default)
        {
            foreach (var (key, blob) in blobs.Where(kv => kv.Key.StartsWith(sourcePrefix, StringComparison.Ordinal)).ToList())
                blobs[string.Concat(destPrefix, key.AsSpan(sourcePrefix.Length))] = blob;
            return Task.CompletedTask;
        }
    }

    private static async Task<(string BibleId, string OrganizationId)> GetSeededBibleAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        var bible = await context.Bibles.FirstAsync(b => b.OrganizationId == "mock-org-sv");
        return (bible.Id, bible.OrganizationId);
    }

    private static async Task EnableCcliCollectionAsync(WebAppFixture app)
    {
        await using var context = app.Services
            .GetRequiredService<IDbContextFactory<PresentationContext>>()
            .CreateDbContext();
        var existing = await context.OrganizationSettings.FirstOrDefaultAsync(
            s => s.OrganizationId == "mock-org-sv" && s.Key == OrganizationSetting.CcliCollectionEnabled);
        if (existing is null)
            context.OrganizationSettings.Add(new OrganizationSetting
            {
                OrganizationId = "mock-org-sv",
                Key = OrganizationSetting.CcliCollectionEnabled,
                Value = "true"
            });
        else
            existing.Value = "true";
        await context.SaveChangesAsync();
    }

    private static async Task<HttpClient> CreateDeviceClientAsync(WebAppFixture app)
    {
        var cookies = new CookieContainerHandler();
        var cookieClient = app.CreateDefaultClient(BaseAddress, cookies);
        (await cookieClient.GetAsync($"/mock-signin/{WebAppFixture.MockUserId}"))
            .StatusCode.ShouldBe(HttpStatusCode.Redirect);

        var login = await cookieClient.GetAsync("/app-login?device=Sidokanaler");
        var token = await DeviceLogin.ReadTokenAsync(login);

        var deviceClient = app.CreateDefaultClient(BaseAddress);
        deviceClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return deviceClient;
    }
}
