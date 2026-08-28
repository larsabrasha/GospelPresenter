using System.Net;
using System.Text;
using GospelPresenter.Client;
using GospelPresenter.Client.Bibles;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// The opt-in offline Bible flow: the sync pull only carries metadata (VersesJson stays "[]"),
/// the user's download fills it without disturbing the server's ModifiedAt, the pin survives and
/// refreshes when the server-side translation changes, and removal frees the verses again.
/// Also the device's CCLI recorder: a displayed song becomes a journaled local report row.
/// </summary>
public class BibleOfflineTests : IAsyncLifetime, IDisposable
{
    private static readonly DateTimeOffset T1 = DateTimeOffset.FromUnixTimeMilliseconds(1_700_000_000_000);
    private static readonly DateTimeOffset T2 = T1.AddMinutes(1);

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<ClientDataContext> factory;
    private readonly FakeBibleServer server = new();
    private readonly BibleOfflineService service;
    private readonly FakeBibleService bibleService = new();

    public BibleOfflineTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<ClientDataContext>().UseSqlite(connection).Options;
        factory = new TestDbContextFactory(options);

        var http = new HttpClient(server) { BaseAddress = new Uri("https://localhost/") };
        service = new BibleOfflineService(factory, http, bibleService, NullLogger<BibleOfflineService>.Instance);
    }

    public async Task InitializeAsync()
    {
        var initializer = new ClientDatabaseInitializer(factory, NullLogger<ClientDatabaseInitializer>.Instance);
        await initializer.InitializeAsync();

        await using var db = await factory.CreateDbContextAsync();
        db.Organizations.Add(new Organization { Id = "org-1", Name = "Org" });
        await db.SaveChangesAsync();

        // As after a pull: metadata present, verses not, the server's stamp preserved.
        db.ApplyingServerChanges = true;
        db.Bibles.Add(new DbBible
        {
            Id = "bible-1", Name = "Bibel 2000", Abbreviation = "B2000", VerseCount = 2,
            OrganizationId = "org-1", ModifiedAt = T1,
        });
        await db.SaveChangesAsync();
        db.ApplyingServerChanges = false;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    public void Dispose() => connection.Dispose();

    [Fact]
    public async Task Download_FillsTheVerses_KeepsTheServerStamp_AndReloadsTheCache()
    {
        // Arrange
        server.VersesJson["bible-1"] = """[{"b":"GEN"}]""";

        // Act
        var downloaded = await service.DownloadAsync("org-1", "B2000");

        // Assert
        downloaded.ShouldBeTrue();
        await using var db = await factory.CreateDbContextAsync();
        var bible = await db.Bibles.SingleAsync();
        bible.VersesJson.ShouldBe("""[{"b":"GEN"}]""");
        bible.ModifiedAt.ShouldBe(T1, "the download must not look like a local edit");
        bibleService.Reloads.ShouldBe(1);
        (await service.GetStatesAsync("org-1"))["B2000"].ShouldBe(BibleOfflineState.Downloaded);
    }

    [Fact]
    public async Task Remove_FreesTheVersesAndTheState()
    {
        // Arrange
        server.VersesJson["bible-1"] = """[{"b":"GEN"}]""";
        await service.DownloadAsync("org-1", "B2000");

        // Act
        await service.RemoveAsync("org-1", "B2000");

        // Assert
        await using var db = await factory.CreateDbContextAsync();
        (await db.Bibles.SingleAsync()).VersesJson.ShouldBe("[]");
        (await service.GetStatesAsync("org-1"))["B2000"].ShouldBe(BibleOfflineState.NotAvailable);
    }

    [Fact]
    public async Task RefreshStale_ReDownloadsAPinnedBibleWhoseStampMoved()
    {
        // Arrange -- downloaded at T1, then the server re-imported the translation (stamp T2)
        server.VersesJson["bible-1"] = """[{"v":"old"}]""";
        await service.DownloadAsync("org-1", "B2000");

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.ApplyingServerChanges = true;
            (await db.Bibles.SingleAsync()).ModifiedAt = T2;
            await db.SaveChangesAsync();
        }
        server.VersesJson["bible-1"] = """[{"v":"new"}]""";

        // Act
        await service.RefreshStaleAsync();
        var again = server.Requests.Count;
        await service.RefreshStaleAsync();

        // Assert -- refreshed once, then recognized as current
        await using var verify = await factory.CreateDbContextAsync();
        (await verify.Bibles.SingleAsync()).VersesJson.ShouldBe("""[{"v":"new"}]""");
        server.Requests.Count.ShouldBe(again, "an up-to-date pin must not re-download");
    }

    [Fact]
    public async Task AnUnpinnedImportedBible_IsReportedButNeverRefreshed()
    {
        // Arrange -- a translation imported on this device (verses exist, no pin)
        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Bibles.Add(new DbBible
            {
                Id = "bible-local", Name = "Lokal", Abbreviation = "LOK", VerseCount = 1,
                OrganizationId = "org-1", VersesJson = """[{"b":"GEN"}]""",
            });
            await db.SaveChangesAsync();
        }

        // Act
        var states = await service.GetStatesAsync("org-1");
        await service.RefreshStaleAsync();

        // Assert
        states["LOK"].ShouldBe(BibleOfflineState.ImportedLocally);
        server.Requests.ShouldBeEmpty();
    }

    [Fact]
    public async Task ADisplayedSong_BecomesAJournaledReportRow()
    {
        // Arrange -- collection enabled for the organisation
        await using (var db = await factory.CreateDbContextAsync())
        {
            db.OrganizationSettings.Add(new OrganizationSetting
            {
                OrganizationId = "org-1", Key = OrganizationSetting.CcliCollectionEnabled, Value = "true",
            });
            await db.SaveChangesAsync();
            await db.SyncJournal.ExecuteDeleteAsync();
        }

        var sharedAppState = new SharedAppState(TimeSpan.FromMinutes(240));
        var ccliService = new CcliReportService(
            (IDbContextFactory<GospelPresenter.Shared.Contexts.PresentationContext>)factory,
            NullLogger<CcliReportService>.Instance);
        using var listener = new CcliReportListener(sharedAppState, ccliService, NullLogger<CcliReportListener>.Instance);

        // Act
        await listener.RecordAsync(new CcliSongDisplayedEvent(
            "org-1", "song-1", "Sången", "12345", "pres-1", "Gudstjänst"));

        // Assert -- the row exists and the journal queues it for the CCLI sync endpoint
        await using var verify = await factory.CreateDbContextAsync();
        var entry = await verify.CcliReportEntries.SingleAsync();
        entry.CcliNumber.ShouldBe("12345");
        (await verify.SyncJournal.SingleAsync()).EntityTable.ShouldBe("CcliReportEntries");
    }

    private class TestDbContextFactory(DbContextOptions<ClientDataContext> options)
        : IDbContextFactory<ClientDataContext>, IDbContextFactory<GospelPresenter.Shared.Contexts.PresentationContext>
    {
        public ClientDataContext CreateDbContext() => new(options);

        GospelPresenter.Shared.Contexts.PresentationContext
            IDbContextFactory<GospelPresenter.Shared.Contexts.PresentationContext>.CreateDbContext() => CreateDbContext();
    }

    private class FakeBibleService : IBibleService
    {
        public int Reloads { get; private set; }

        public Task LoadBiblesAsync()
        {
            Reloads++;
            return Task.CompletedTask;
        }

        public IReadOnlyList<Bible> GetBibles(string organizationId) => [];
        public IEnumerable<Verse> Search(string organizationId, string bibleId, string query) => [];
        public IReadOnlyList<string> GetBooks(string organizationId, string bibleId) => [];
        public IReadOnlyList<int> GetChapters(string organizationId, string bibleId, string bookId) => [];
        public IReadOnlyList<Verse> GetVerses(string organizationId, string bibleId, string bookId, int chapter) => [];
        public Task<ImportBibleResult> ImportBibleAsync(Stream zipStream, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();
        public Task DeleteBibleAsync(string bibleId, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();
    }

    private class FakeBibleServer : HttpMessageHandler
    {
        public Dictionary<string, string> VersesJson { get; } = [];
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            Requests.Add(path);
            var bibleId = path.Split('/')[^1];
            if (!VersesJson.TryGetValue(bibleId, out var json))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
        }
    }
}
