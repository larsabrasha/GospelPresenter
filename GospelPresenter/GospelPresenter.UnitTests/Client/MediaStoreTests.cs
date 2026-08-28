using System.Net;
using System.Text;
using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Client.Media;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// The device's media layer: the blob store and its eviction rules, the storage facade the domain
/// services write through, the pin reconciliation that keeps presentable media on disk, and the
/// upload queue. Real files in a temp directory, real SQLite ledger.
/// </summary>
public class MediaStoreTests : IAsyncLifetime, IDisposable
{
    private static readonly DeviceIdentity Identity =
        new("user-1", "Anna", "anna@example.com", UserRole.Admin, "org-1", "Församlingen");

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<ClientDataContext> factory;
    private readonly string rootDirectory;
    private readonly string identityPath;
    private readonly MediaStore store;
    private readonly DeviceAuthService auth;

    public MediaStoreTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<ClientDataContext>().UseSqlite(connection).Options;
        factory = new TestDbContextFactory(options);

        rootDirectory = Path.Combine(Path.GetTempPath(), $"gp-media-test-{Guid.NewGuid()}");
        identityPath = Path.Combine(Path.GetTempPath(), $"gp-media-test-identity-{Guid.NewGuid()}.json");
        store = new MediaStore(factory, rootDirectory, NullLogger<MediaStore>.Instance);
        auth = new DeviceAuthService(new FakeTokenStore(), identityPath, NullLogger<DeviceAuthService>.Instance);
    }

    public async Task InitializeAsync()
    {
        var initializer = new ClientDatabaseInitializer(factory, NullLogger<ClientDatabaseInitializer>.Instance);
        await initializer.InitializeAsync();
        await auth.SignInAsync("gpdt_test", Identity);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    public void Dispose()
    {
        connection.Dispose();
        if (Directory.Exists(rootDirectory))
            Directory.Delete(rootDirectory, recursive: true);
        if (File.Exists(identityPath))
            File.Delete(identityPath);
    }

    [Fact]
    public async Task SaveAndGet_RoundTripsBytesAndContentType()
    {
        // Act
        await store.SaveAsync("org/org-1/images/img-1/full", [1, 2, 3], "image/webp", MediaCacheState.Cached, pinned: false);
        var result = await store.GetAsync("org/org-1/images/img-1/full");

        // Assert
        result.ShouldNotBeNull();
        result.Value.ContentType.ShouldBe("image/webp");
        await using var stream = result.Value.Stream;
        var buffer = new byte[3];
        (await stream.ReadAsync(buffer)).ShouldBe(3);
        buffer.ShouldBe([1, 2, 3]);
    }

    [Fact]
    public async Task AWriteOverAPendingUpload_StaysPendingUpload()
    {
        // Arrange -- created locally, then somehow re-saved as a download before the upload ran
        await store.SaveAsync("key", [1], "image/webp", MediaCacheState.PendingUpload, pinned: false);

        // Act
        await store.SaveAsync("key", [2], "image/webp", MediaCacheState.Cached, pinned: false);

        // Assert -- the blob still exists nowhere else, so it must remain queued
        (await store.GetPendingUploadsAsync()).ShouldHaveSingleItem().Key.ShouldBe("key");
    }

    [Fact]
    public async Task DeleteByPrefix_RemovesLedgerRowsAndFiles()
    {
        // Arrange
        await store.SaveAsync("org/org-1/images/img-1/full", [1], "image/webp", MediaCacheState.Cached, pinned: false);
        await store.SaveAsync("org/org-1/images/img-1/thumb", [2], "image/webp", MediaCacheState.Cached, pinned: false);
        await store.SaveAsync("org/org-1/images/img-2/full", [3], "image/webp", MediaCacheState.Cached, pinned: false);

        // Act
        await store.DeleteByPrefixAsync("org/org-1/images/img-1/");

        // Assert
        (await store.GetAsync("org/org-1/images/img-1/full")).ShouldBeNull();
        (await store.GetAsync("org/org-1/images/img-2/full")).ShouldNotBeNull();
        Directory.GetFiles(rootDirectory, "*", SearchOption.AllDirectories).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task CopyByPrefix_QueuesTheCopiesForUpload()
    {
        // Arrange -- the source is already on the server; the copy is not
        await store.SaveAsync("org/org-1/slides/deck-1/page-0.webp", [1], "image/webp", MediaCacheState.Cached, pinned: false);

        // Act
        await store.CopyByPrefixAsync("org/org-1/slides/deck-1/", "org/org-1/slides/deck-2/");

        // Assert
        (await store.GetAsync("org/org-1/slides/deck-2/page-0.webp")).ShouldNotBeNull();
        (await store.GetPendingUploadsAsync()).ShouldHaveSingleItem().Key.ShouldBe("org/org-1/slides/deck-2/page-0.webp");
    }

    [Fact]
    public async Task Eviction_TakesTheLeastRecentlyUsedUnpinnedBlobsOnly()
    {
        // Arrange -- three unpinned cached blobs with distinct ages, a pinned one and an upload
        await SaveWithAccessTimeAsync("old", daysAgo: 3);
        await SaveWithAccessTimeAsync("middle", daysAgo: 2);
        await SaveWithAccessTimeAsync("fresh", daysAgo: 1);
        await store.SaveAsync("pinned", new byte[100], "image/webp", MediaCacheState.Cached, pinned: true);
        await store.SaveAsync("upload", new byte[100], "image/webp", MediaCacheState.PendingUpload, pinned: false);

        // Act -- 500 bytes stored, the budget fits 300: the two oldest unpinned blobs must go
        await store.EvictOverBudgetAsync(300);

        // Assert
        (await store.GetAsync("old")).ShouldBeNull();
        (await store.GetAsync("middle")).ShouldBeNull();
        (await store.GetAsync("fresh")).ShouldNotBeNull();
        (await store.GetAsync("pinned")).ShouldNotBeNull();
        (await store.GetAsync("upload")).ShouldNotBeNull();
    }

    private async Task SaveWithAccessTimeAsync(string key, int daysAgo)
    {
        await store.SaveAsync(key, new byte[100], "image/webp", MediaCacheState.Cached, pinned: false);
        await using var db = await factory.CreateDbContextAsync();
        (await db.MediaCache.FindAsync(key))!.LastAccessAt = DateTimeOffset.UtcNow.AddDays(-daysAgo);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task TheStorageFacade_DownloadsAMissOnceAndServesLocallyAfter()
    {
        // Arrange
        var downloader = new FakeDownloader { ["org/org-1/images/img-1/full"] = ([9, 9], "image/webp") };
        var storage = new LocalObjectStorageService(store, downloader, NullLogger<LocalObjectStorageService>.Instance);

        // Act
        var first = await storage.GetAsync("org/org-1/images/img-1/full");
        var second = await storage.GetAsync("org/org-1/images/img-1/full");

        // Assert
        first.ShouldNotBeNull();
        await first.Value.Stream.DisposeAsync();
        second.ShouldNotBeNull();
        await second.Value.Stream.DisposeAsync();
        downloader.Requests.Count(k => k == "org/org-1/images/img-1/full").ShouldBe(1);
    }

    [Fact]
    public async Task TheRequestHandler_ServesStoreBlobsThemeArtAndRanges()
    {
        // Arrange
        var storage = new LocalObjectStorageService(store, new FakeDownloader(), NullLogger<LocalObjectStorageService>.Instance);
        var handler = new MediaRequestHandler(storage, new FakeThemeAssets(), auth);
        await store.SaveAsync("org/org-1/audios/aud-1/file", Encoding.ASCII.GetBytes("0123456789"), "audio/mpeg",
            MediaCacheState.Cached, pinned: false);

        // Act & Assert -- a stored blob, resolved through the signed-in organisation
        var full = await handler.HandleAsync("/api/audio/org-audio/aud-1", rangeHeader: null);
        full.ShouldNotBeNull();
        full.Status.ShouldBe(200);
        full.Data.Length.ShouldBe(10);

        // ...a range request gets a 206 slice
        var slice = await handler.HandleAsync("/api/audio/org-audio/aud-1", "bytes=2-4");
        slice.ShouldNotBeNull();
        slice.Status.ShouldBe(206);
        Encoding.ASCII.GetString(slice.Data).ShouldBe("234");
        slice.ContentRange.ShouldBe("bytes 2-4/10");

        // ...theme art comes from the embedded assets, no store involved
        var theme = await handler.HandleAsync("/api/theme-images/aurora/background-full-abc123.webp", null);
        theme.ShouldNotBeNull();
        theme.ContentType.ShouldBe("image/webp");

        // ...and anything unknown is a 404 for the platform shell to send
        (await handler.HandleAsync("/api/audio/org-audio/missing", null)).ShouldBeNull();
    }

    [Fact]
    public async Task PinReconciliation_DownloadsReferencedMediaAndReleasesTheRest()
    {
        // Arrange -- a presentation referencing one image and a deck; a second image only exists
        // in the library (thumb wanted, full not); a stale pinned blob no longer referenced
        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Organizations.Add(new Organization { Id = "org-1", Name = "Org" });
            db.OrganizationImages.Add(new OrganizationImage { Id = "img-used", OrganizationId = "org-1" });
            db.OrganizationImages.Add(new OrganizationImage { Id = "img-library", OrganizationId = "org-1" });
            db.Presentations.Add(new Presentation
            {
                Id = "pres-1", Name = "P", OrganizationId = "org-1", CreatedBy = "u", UpdatedBy = "u",
                Items =
                {
                    new PresentationItem { Id = "item-1", Type = PresentationItemType.Image, SourceId = "img-used" },
                    new PresentationItem { Id = "item-2", Type = PresentationItemType.Slides, SourceId = "deck-1" },
                },
                SlideDecks = { new PresentationSlides { Id = "deck-1", PageCount = 2 } },
            });
            await db.SaveChangesAsync();
        }

        await store.SaveAsync("org/org-1/images/img-gone/full", [1], "image/webp", MediaCacheState.Cached, pinned: true);

        var downloader = new FakeDownloader
        {
            ["org/org-1/images/img-used/full"] = ([1], "image/webp"),
            ["org/org-1/images/img-used/thumb"] = ([1], "image/webp"),
            ["org/org-1/images/img-library/thumb"] = ([1], "image/webp"),
            ["org/org-1/slides/deck-1/page-0.webp"] = ([1], "image/webp"),
            ["org/org-1/slides/deck-1/page-1.webp"] = ([1], "image/webp"),
        };
        var pins = new MediaPinService(factory, store, downloader, auth, NullLogger<MediaPinService>.Instance);

        // Act
        await pins.ReconcileAsync();

        // Assert -- everything referenced (and every thumb) was fetched...
        var known = await store.GetKnownKeysAsync();
        known.ShouldContain("org/org-1/images/img-used/full");
        known.ShouldContain("org/org-1/images/img-used/thumb");
        known.ShouldContain("org/org-1/images/img-library/thumb");
        known.ShouldContain("org/org-1/slides/deck-1/page-0.webp");
        known.ShouldContain("org/org-1/slides/deck-1/page-1.webp");
        downloader.Requests.ShouldNotContain("org/org-1/images/img-library/full");

        // ...and the blob nothing references any more became evictable
        await using var verify = await factory.CreateDbContextAsync();
        (await verify.MediaCache.FindAsync("org/org-1/images/img-gone/full"))!.Pinned.ShouldBeFalse();
        (await verify.MediaCache.FindAsync("org/org-1/images/img-used/full"))!.Pinned.ShouldBeTrue();
    }

    [Fact]
    public async Task TheSynchronizer_UploadsPendingBlobsAndLeavesRefusedOnesQueued()
    {
        // Arrange
        await store.SaveAsync("org/org-1/images/img-ok/full", [1, 2], "image/webp", MediaCacheState.PendingUpload, pinned: false);
        await store.SaveAsync("org/org-1/images/img-denied/full", [3], "image/webp", MediaCacheState.PendingUpload, pinned: false);

        var server = new FakeMediaServer(key => key.Contains("img-denied") ? HttpStatusCode.Forbidden : HttpStatusCode.NoContent);
        var http = new HttpClient(server) { BaseAddress = new Uri("https://localhost/") };
        var pins = new MediaPinService(factory, store, new FakeDownloader(), auth, NullLogger<MediaPinService>.Instance);
        var synchronizer = new MediaSynchronizer(store, http, pins, NullLogger<MediaSynchronizer>.Instance);

        // Act
        await synchronizer.SyncAsync();

        // Assert
        server.Uploads.ShouldContain("/api/sync/media/org/org-1/images/img-ok/full");
        (await store.GetPendingUploadsAsync()).ShouldHaveSingleItem().Key.ShouldBe("org/org-1/images/img-denied/full");
    }

    private class TestDbContextFactory(DbContextOptions<ClientDataContext> options)
        : IDbContextFactory<ClientDataContext>
    {
        public ClientDataContext CreateDbContext() => new(options);
    }

    private class FakeDownloader : Dictionary<string, (byte[] Data, string ContentType)>, IMediaDownloader
    {
        public List<string> Requests { get; } = [];

        public Task<(byte[] Data, string ContentType)?> DownloadAsync(string key, CancellationToken cancellationToken = default)
        {
            Requests.Add(key);
            return Task.FromResult(TryGetValue(key, out var blob) ? blob : ((byte[], string)?)null);
        }
    }

    private class FakeThemeAssets : IThemeAssetService
    {
        public byte[]? ReadAsset(string assetPath) => assetPath == "aurora/background" ? [7, 7] : null;
        public string? ComputeContentHash(string assetPath) => "abc123";
    }

    private class FakeMediaServer(Func<string, HttpStatusCode> respond) : HttpMessageHandler
    {
        public List<string> Uploads { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            Uploads.Add(path);
            return Task.FromResult(new HttpResponseMessage(respond(path)));
        }
    }

    private class FakeTokenStore : ISecureTokenStore
    {
        private string? token;
        public Task<string?> GetTokenAsync() => Task.FromResult(token);
        public Task SetTokenAsync(string value) { token = value; return Task.CompletedTask; }
        public Task RemoveTokenAsync() { token = null; return Task.CompletedTask; }
    }
}
