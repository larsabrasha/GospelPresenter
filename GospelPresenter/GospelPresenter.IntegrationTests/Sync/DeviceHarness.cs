using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Client.Sync;
using GospelPresenter.IntegrationTests.Fixtures;
using GospelPresenter.IntegrationTests.Helpers;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

using static GospelPresenter.IntegrationTests.Sync.SyncTestEnvironment;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// One installed device: its own SQLite database with the real migrations and triggers, the real
/// sync engine over an HttpClient that reaches the test server, and the real scheduler and doorbell
/// on top. The only fakes are the things a test cannot have — the network's up/down state and the
/// machine's secure storage.
///
/// Two of these can run against one server, which is what makes "the other machine" a real device
/// rather than a second call to a service. They must take turns, though: the test server's database
/// is one shared in-memory connection, so a test awaits one device's cycle before provoking the
/// other rather than letting the two race.
/// </summary>
internal sealed class DeviceHarness : IAsyncDisposable
{
    private readonly WebAppFixture app;
    private readonly SqliteConnection connection;
    private readonly string databasePath;
    private readonly string identityPath;
    private readonly RequestCounter counter = new();
    private readonly LocalWriteSignal localWrites = new();
    private readonly string token;
    private readonly string deviceName;

    public ClientDataContextFactory Factory { get; }
    public DeviceAuthService Auth { get; }
    public FakeConnectivity Connectivity { get; } = new();
    public SyncScheduler Scheduler { get; private set; }
    public OrganizationChangesClient Doorbell { get; private set; }

    /// <summary>The organisation this machine is signed in to, and the user it is signed in as.</summary>
    public string Organization { get; }
    public string User { get; }

    /// <summary>How many pulls this device has asked the server for.</summary>
    public int Pulls => counter.Pulls;

    /// <summary>How many pushes this device has sent.</summary>
    public int Pushes => counter.Pushes;

    /// <summary>Everything the server resolved against this device, as the UI would be told.</summary>
    public List<SyncPushResult> Conflicts { get; } = [];

    private DeviceHarness(WebAppFixture app, string token, string userId, string organizationId, string deviceName)
    {
        this.app = app;
        this.token = token;
        this.deviceName = deviceName;
        User = userId;
        Organization = organizationId;

        // A file, with the connection string the desktop app itself uses — not the shared
        // in-memory connection the other tests get away with. A sync in flight and a test
        // reading the same database are two connections at once, and one in-memory connection
        // shared between them answers "database is locked". SQLite on a file with a shared
        // cache does what it does on a real device: waits its turn.
        databasePath = Path.Combine(Path.GetTempPath(), $"gp-e2e-{Guid.NewGuid()}.db");
        connection = new SqliteConnection($"Data Source={databasePath};Cache=Shared");
        connection.Open();

        Factory = new ClientDataContextFactory(new DbContextOptionsBuilder<ClientDataContext>()
            .UseSqlite($"Data Source={databasePath};Cache=Shared")
            .AddInterceptors(new LocalWriteInterceptor(localWrites))
            .Options);

        identityPath = Path.Combine(Path.GetTempPath(), $"gp-e2e-identity-{Guid.NewGuid()}.json");
        Auth = new DeviceAuthService(
            new InMemoryTokenStore(), identityPath, NullLogger<DeviceAuthService>.Instance);

        Scheduler = BuildScheduler();
        Doorbell = BuildDoorbell();
    }

    public static Task<DeviceHarness> CreateAsync(WebAppFixture app) =>
        CreateAsync(app, WebAppFixture.MockUserId, OrganizationId, "Testmaskin");

    public static async Task<DeviceHarness> CreateAsync(
        WebAppFixture app, string userId, string organizationId, string deviceName)
    {
        var harness = new DeviceHarness(
            app, await IssueDeviceTokenAsync(app, userId, deviceName), userId, organizationId, deviceName);

        await new ClientDatabaseInitializer(
            harness.Factory, NullLogger<ClientDatabaseInitializer>.Instance).InitializeAsync();

        await harness.Auth.SignInAsync(harness.token, new DeviceIdentity(
            userId, "Anna", "anna@example.com", UserRole.Admin, organizationId, "Foo Bar Kyrka"));

        return harness;
    }

    private SyncScheduler BuildScheduler()
    {
        var http = new HttpClient(counter.Wrap(app.Server.CreateHandler(), token))
        {
            BaseAddress = BaseAddress,
        };

        var engine = new ClientSyncService(
            Factory, http, new NoCacheRefresher(), Auth, deviceName,
            NullLogger<ClientSyncService>.Instance);

        var scheduler = new SyncScheduler(
            engine, Factory, Connectivity, Auth, NullLogger<SyncScheduler>.Instance,
            localWrites: localWrites)
        {
            // Neither of these may fire during a test: an arrival has to be explained by the
            // announcement or by the reconnection, never by a timer.
            PollInterval = TimeSpan.FromMinutes(5),
            IdlePullInterval = TimeSpan.FromMinutes(5),
            WriteSignalDelay = TimeSpan.FromMilliseconds(100),
        };

        scheduler.ConflictReported += result =>
        {
            lock (Conflicts)
                Conflicts.Add(result);
        };

        return scheduler;
    }

    private OrganizationChangesClient BuildDoorbell() => new(
        Scheduler, Auth, BaseAddress.ToString(), NullLogger<OrganizationChangesClient>.Instance,
        options =>
        {
            options.Transports = HttpTransportType.LongPolling;
            options.HttpMessageHandlerFactory = _ => app.Server.CreateHandler();
        });

    /// <summary>
    /// The machine is switched off and started again: everything in memory is rebuilt, and only
    /// what is on disk — the database, the watermark, the journal — survives. The token survives
    /// too, because on a real machine it is in the keychain rather than in the process.
    /// </summary>
    public async Task RestartAsync()
    {
        await Doorbell.DisposeAsync();
        Scheduler.Dispose();
        Scheduler = BuildScheduler();
        Doorbell = BuildDoorbell();
    }

    /// <summary>
    /// Waits until the hub has certainly finished registering this connection. The client's
    /// handshake can complete before the server's OnConnectedAsync has joined the group, and an
    /// announcement made in that window goes nowhere.
    /// </summary>
    public async Task WaitUntilListeningAsync()
    {
        await WaitUntilAsync(() => Task.FromResult(Doorbell.IsConnected), "the doorbell should connect");
        await Task.Delay(TimeSpan.FromMilliseconds(500));
    }

    /// <summary>
    /// Waits until this device has nothing in flight and nothing waiting: no sync running, and
    /// an empty journal. What "the device has caught up" means, and the only safe moment to look
    /// at the server's database from a test.
    /// </summary>
    public async Task WaitUntilQuietAsync() => await WaitUntilAsync(
        async () => Scheduler.Status is SyncStatus.Idle or SyncStatus.Offline
                    && await PendingJournalRowsAsync() == 0,
        $"the device should have settled, but its status was {Scheduler.Status}");

    /// <summary>The network takes the socket away, without the device signing out.</summary>
    public async Task DropTheDoorbellAsync()
    {
        await Doorbell.DisposeAsync();
        Doorbell = BuildDoorbell();
    }

    public async Task RestoreTheDoorbellAsync()
    {
        Doorbell.Start();
        await WaitUntilListeningAsync();
    }

    // --- Editing, through the same domain services the device's own UI uses ---

    private PresentationService Presentations => new(Factory, new NoObjectStorage());
    private SongService Songs => new(Factory);

    public Task RenameLocallyAsync(string name) => RenameLocallyAsync(PresentationId, name);

    public async Task RenameLocallyAsync(string presentationId, string name) =>
        await Presentations.RenamePresentationAsync(Organization, presentationId, name, Caller(Organization, User));

    public async Task DeletePresentationLocallyAsync(string presentationId) =>
        await Presentations.DeletePresentationAsync(Organization, presentationId, Caller(Organization, User));

    /// <summary>
    /// Adds an item to a presentation: a child row, which carries no organisation of its own and
    /// only announces because adding it bumps the presentation that does.
    /// </summary>
    public async Task<string> AddItemLocallyAsync(string presentationId, string title)
    {
        var item = new PresentationItem { Title = title, Type = PresentationItemType.Song };
        await Presentations.AddItemAsync(Organization, presentationId, item, Caller(Organization, User));
        return item.Id;
    }

    public async Task RenameSongLocallyAsync(string songId, string name) =>
        await Songs.UpdateSongAsync(
            songId, Organization, name, author: null, publisher: null, year: null, ccli: null,
            Caller(Organization, User));

    public async Task DeleteSongLocallyAsync(string songId) =>
        await Songs.DeleteSongAsync(songId, Organization, Caller(Organization, User));

    // --- Reading this device's own database ---

    public async Task<string?> PresentationNameAsync(string? id = null)
    {
        await using var db = Factory.CreateDbContext();
        return await db.Presentations
            .Where(p => p.Id == (id ?? PresentationId))
            .Select(p => p.Name)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Whether the device shows this presentation in its library. A trashed one does not count:
    /// the row is still there, which is what makes it restorable, but nothing lists it.
    /// </summary>
    public async Task<bool> HasPresentationAsync(string id)
    {
        await using var db = Factory.CreateDbContext();
        return await db.Presentations.NotDeleted().AnyAsync(p => p.Id == id);
    }

    /// <summary>Whether this presentation reached the device's trash.</summary>
    public async Task<bool> HasTrashedPresentationAsync(string id)
    {
        await using var db = Factory.CreateDbContext();
        return await db.Presentations.OnlyDeleted().AnyAsync(p => p.Id == id);
    }

    public async Task<int> ItemCountAsync(string presentationId)
    {
        await using var db = Factory.CreateDbContext();
        return await db.PresentationItems.CountAsync(i => i.PresentationId == presentationId);
    }

    public async Task<string?> SongNameAsync(string songId)
    {
        await using var db = Factory.CreateDbContext();
        return await db.Songs.Where(s => s.Id == songId).Select(s => s.Name).FirstOrDefaultAsync();
    }

    public async Task<bool> HasSongAsync(string songId)
    {
        await using var db = Factory.CreateDbContext();
        return await db.Songs.AnyAsync(s => s.Id == songId);
    }

    /// <summary>Whether the song is here and not in the trash, which is what a library shows.</summary>
    public async Task<bool> HasLiveSongAsync(string songId)
    {
        await using var db = Factory.CreateDbContext();
        return await db.Songs.AnyAsync(s => s.Id == songId && s.DeletedAt == null);
    }

    public async Task<string?> UserSettingAsync(string key)
    {
        await using var db = Factory.CreateDbContext();
        return await db.UserSettings
            .Where(s => s.UserId == User && s.Key == key)
            .Select(s => s.Value)
            .FirstOrDefaultAsync();
    }

    public async Task<int> PendingJournalRowsAsync()
    {
        await using var db = Factory.CreateDbContext();
        return await db.SyncJournal.CountAsync();
    }

    /// <summary>
    /// Where this device believes it has read up to. It is what a restart must not lose: fetched
    /// again from zero, a device would refetch the whole library on every launch.
    /// </summary>
    public async Task<string?> WatermarkAsync()
    {
        await using var db = Factory.CreateDbContext();
        return await db.SyncState
            .Where(s => s.Key == "watermark")
            .Select(s => s.Value)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// The organisation's library as this device holds it, in a shape that can be compared with the
    /// server's answer to the same question. Ids and names rather than counts: a count matches for
    /// the wrong reasons often enough to be worth avoiding.
    /// </summary>
    public async Task<LibrarySnapshot> SnapshotAsync()
    {
        await using var db = Factory.CreateDbContext();
        return new LibrarySnapshot(
            await db.Presentations.OrderBy(p => p.Id).Select(p => p.Id + "|" + p.Name).ToListAsync(),
            await db.Songs.Where(s => s.DeletedAt == null).OrderBy(s => s.Id).Select(s => s.Id + "|" + s.Name).ToListAsync(),
            await db.PresentationItems.OrderBy(i => i.Id).Select(i => i.Id + "|" + i.Title).ToListAsync());
    }

    public async ValueTask DisposeAsync()
    {
        await Doorbell.DisposeAsync();
        Scheduler.Dispose();
        connection.Dispose();
        SqliteConnection.ClearAllPools();
        foreach (var path in new[] { identityPath, databasePath })
            if (File.Exists(path))
                File.Delete(path);
    }

    private static async Task<string> IssueDeviceTokenAsync(WebAppFixture app, string userId, string deviceName)
    {
        var cookieClient = app.CreateDefaultClient(
            BaseAddress, new RedirectHandler(), new CookieContainerHandler());
        cookieClient.DefaultRequestHeaders.Add("Cookie", $"mock-user-id={userId}");

        var response = await cookieClient.GetAsync($"/app-login?device={Uri.EscapeDataString(deviceName)}");
        return await DeviceLogin.ReadTokenAsync(response);
    }

    /// <summary>Carries the device token and counts what the engine asks for.</summary>
    private sealed class RequestCounter
    {
        private int pulls;
        private int pushes;

        public int Pulls => Volatile.Read(ref pulls);
        public int Pushes => Volatile.Read(ref pushes);

        public HttpMessageHandler Wrap(HttpMessageHandler inner, string token) =>
            new CountingHandler(inner, token, this);

        private void Count(string path)
        {
            if (path == "/api/sync/pull") Interlocked.Increment(ref pulls);
            else if (path == "/api/sync/push") Interlocked.Increment(ref pushes);
        }

        private sealed class CountingHandler(HttpMessageHandler inner, string token, RequestCounter counter)
            : DelegatingHandler(inner)
        {
            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request, CancellationToken cancellationToken)
            {
                request.Headers.Authorization = new("Bearer", token);
                if (request.RequestUri?.AbsolutePath is { } path)
                    counter.Count(path);
                return base.SendAsync(request, cancellationToken);
            }
        }
    }
}

/// <summary>What one end holds, for comparing two ends row by row rather than by count.</summary>
internal sealed record LibrarySnapshot(
    List<string> Presentations,
    List<string> Songs,
    List<string> Items);

internal sealed class FakeConnectivity : IConnectivityMonitor
{
    public bool IsOnline { get; private set; } = true;
    public event Action? Changed;

    public void GoOffline()
    {
        IsOnline = false;
        Changed?.Invoke();
    }

    public void GoOnline()
    {
        IsOnline = true;
        Changed?.Invoke();
    }
}

/// <summary>The device's in-memory caches are not what these tests are about.</summary>
internal sealed class NoCacheRefresher : ISyncCacheRefresher
{
    public Task RefreshSongsAsync() => Task.CompletedTask;
    public Task RefreshBiblesAsync() => Task.CompletedTask;
}

internal sealed class InMemoryTokenStore : ISecureTokenStore
{
    private string? token;

    public Task<string?> GetTokenAsync() => Task.FromResult(token);
    public Task SetTokenAsync(string value) { token = value; return Task.CompletedTask; }
    public Task RemoveTokenAsync() { token = null; return Task.CompletedTask; }
}
