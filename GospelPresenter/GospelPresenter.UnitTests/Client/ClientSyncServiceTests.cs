using System.Net;
using System.Text.Json;
using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Client.Sync;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// The client sync engine against a real SQLite database (triggers included) and a fake server.
/// These tests pin the engine's contract: the journal becomes aggregate pushes with the right
/// conflict bases, push outcomes are booked locally, pulls apply atomically without journal echo,
/// rows with in-flight local edits survive a pull, and tombstones cascade like the server's did.
/// </summary>
public class ClientSyncServiceTests : IAsyncLifetime, IDisposable
{
    private static readonly DateTimeOffset T1 = DateTimeOffset.FromUnixTimeMilliseconds(1_700_000_000_000);
    private static readonly DateTimeOffset T2 = T1.AddMinutes(1);
    private static readonly DateTimeOffset T3 = T1.AddMinutes(2);

    // Server row versions. Opaque to the client: the tests only ever check that what the server sent
    // comes back unchanged, which is the whole contract.
    private const long V1 = 41;
    private const long V2 = 42;

    private static readonly DeviceIdentity Identity =
        new("user-1", "Anna", "anna@example.com", UserRole.Admin, "org-1", "Församlingen");

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<ClientDataContext> factory;
    private readonly FakeSyncServer server = new();
    private readonly FakeCacheRefresher refresher = new();
    private readonly DeviceAuthService auth;
    private readonly ClientSyncService engine;
    private readonly string identityPath;

    public ClientSyncServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<ClientDataContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);

        identityPath = Path.Combine(Path.GetTempPath(), $"gp-sync-test-identity-{Guid.NewGuid()}.json");
        auth = new DeviceAuthService(new FakeSecureTokenStore(), identityPath, NullLogger<DeviceAuthService>.Instance);

        var http = new HttpClient(server) { BaseAddress = new Uri("https://localhost/") };
        engine = new ClientSyncService(factory, http, refresher, auth, "Testenhet",
            NullLogger<ClientSyncService>.Instance);
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
        if (File.Exists(identityPath))
            File.Delete(identityPath);
    }

    [Fact]
    public async Task TheFirstSync_CreatesTheIdentityRowsAndStoresTheWatermark()
    {
        // Arrange
        server.OnPull = _ => Pull(T1);

        // Act
        await engine.SyncAsync();

        // Assert
        await using var db = await factory.CreateDbContextAsync();
        (await db.Organizations.FindAsync("org-1"))!.Name.ShouldBe("Församlingen");
        (await db.Users.FindAsync("user-1"))!.Role.ShouldBe(UserRole.Admin);
        var watermark = await db.SyncState.SingleAsync(s => s.Key == SyncStateEntry.WatermarkKey);
        DateTimeOffset.Parse(watermark.Value).ShouldBe(T1);
    }

    [Fact]
    public async Task AnOfflineCreatedSong_IsPushedAsAWholeAggregateWithoutABase()
    {
        // Arrange -- an empty first sync creates the identity rows the song's FK needs
        server.OnPull = _ => Pull(T1);
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Songs.Add(new DbSong
            {
                Id = "song-1", Name = "Ny sång", OrganizationId = "org-1",
                Parts = { new DbSongPart { Id = "part-1", Content = "Vers 1", SortOrder = 0 } },
            });
            await db.SaveChangesAsync();
        }

        server.OnPush = _ => new SyncPushResponse([
            new SyncPushResult(nameof(DbSong), "song-1", SyncPushOutcome.Applied, NewVersion: V2),
        ]);

        // Act
        var summary = await engine.SyncAsync();

        // Assert -- the aggregate travelled whole, with no base (the server never saw it)
        summary.PushedChanges.ShouldBe(1);
        var push = server.PushRequests.ShouldHaveSingleItem().Songs.ShouldHaveSingleItem();
        push.Song.Name.ShouldBe("Ny sång");
        push.Parts.ShouldHaveSingleItem().Content.ShouldBe("Vers 1");
        push.BaseVersion.ShouldBeNull();

        // ...the journal was consumed and the acknowledged stamp became the new base
        await using var verify = await factory.CreateDbContextAsync();
        (await verify.SyncJournal.AnyAsync()).ShouldBeFalse();
        (await verify.SyncBase.SingleAsync(b => b.EntityTable == "Songs" && b.RowId == "song-1"))
            .BaseVersion.ShouldBe(V2);
    }

    [Fact]
    public async Task EditingAPulledSong_PushesWithThePulledBase()
    {
        // Arrange -- the song arrives from the server with stamp T1
        server.OnPull = _ => Pull(T1, changes: c =>
        {
            c.Songs.Add(new SyncSongDto("song-1", "Originalet", null, null, null, null, null, T1, V1));
        });
        await engine.SyncAsync();

        server.OnPull = _ => Pull(T2);
        await using (var db = await factory.CreateDbContextAsync())
        {
            var song = await db.Songs.SingleAsync(s => s.Id == "song-1");
            song.Name = "Lokalt namn";
            await db.SaveChangesAsync();
        }

        server.OnPush = _ => new SyncPushResponse([
            new SyncPushResult(nameof(DbSong), "song-1", SyncPushOutcome.Applied, NewVersion: V2),
        ]);

        // Act
        await engine.SyncAsync();

        // Assert
        var push = server.PushRequests.ShouldHaveSingleItem().Songs.ShouldHaveSingleItem();
        push.BaseVersion.ShouldBe(V1);

        await using var verify = await factory.CreateDbContextAsync();
        (await verify.SyncBase.SingleAsync(b => b.RowId == "song-1")).BaseVersion.ShouldBe(V2);
    }

    [Fact]
    public async Task DeletingAPulledSong_BecomesADeletePushAndDropsTheBase()
    {
        // Arrange
        server.OnPull = _ => Pull(T1, changes: c =>
        {
            c.Songs.Add(new SyncSongDto("song-1", "Sången", null, null, null, null, DateTime.UtcNow, T1, V1));
        });
        await engine.SyncAsync();

        server.OnPull = _ => Pull(T2);
        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Songs.Remove(await db.Songs.SingleAsync(s => s.Id == "song-1"));
            await db.SaveChangesAsync();
        }

        server.OnPush = _ => new SyncPushResponse([
            new SyncPushResult(nameof(DbSong), "song-1", SyncPushOutcome.Applied),
        ]);

        // Act
        await engine.SyncAsync();

        // Assert
        var delete = server.PushRequests.ShouldHaveSingleItem().Deletes.ShouldHaveSingleItem();
        delete.EntityType.ShouldBe(nameof(DbSong));
        delete.Id.ShouldBe("song-1");
        delete.BaseVersion.ShouldBe(V1);

        await using var verify = await factory.CreateDbContextAsync();
        (await verify.SyncBase.AnyAsync(b => b.RowId == "song-1")).ShouldBeFalse();
        (await verify.SyncJournal.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task APull_AppliesServerRowsWithoutJournalEcho_AndReloadsTheCaches()
    {
        // Arrange -- a slice of every kind of row
        server.OnPull = _ => Pull(T2, changes: c =>
        {
            c.SongPartLabels.Add(new SyncSongPartLabelDto("label-1", "Vers", "#123456", 0, T1, V1));
            c.Songs.Add(new SyncSongDto("song-1", "Serversång", "Författare", null, 2020, null, null, T1, V1));
            c.SongParts.Add(new SyncSongPartDto("part-1", "label-1", "Text", 0, "song-1", T1));
            c.SongArrangements.Add(new SyncSongArrangementDto("arr-1", "Kort", "[\"part-1\"]", "song-1", T1));
            c.Presentations.Add(PresentationDto("pres-1", "Gudstjänst", T1));
            c.PresentationItems.Add(new SyncPresentationItemDto("item-1", "song-1", PresentationItemType.Song, "Serversång", null, 0, "pres-1", T1));
            c.PresentationItemParts.Add(new SyncPresentationItemPartDto("ipart-1", "Text", 0, "item-1", T1));
            c.Bibles.Add(new SyncBibleDto("bible-1", "Bibel 2000", "B2000", 31173, T1));
            c.UserSettings.Add(new SyncUserSettingDto("us-1", "PreferredLanguage", "sv", T1, V1));
        });

        // Act
        var summary = await engine.SyncAsync();

        // Assert
        summary.PulledRows.ShouldBe(9);
        await using var db = await factory.CreateDbContextAsync();
        (await db.SongParts.SingleAsync(p => p.Id == "part-1")).LabelId.ShouldBe("label-1");
        (await db.Songs.SingleAsync(s => s.Id == "song-1")).ModifiedAt.ShouldBe(T1);
        (await db.PresentationItemParts.AnyAsync(p => p.Id == "ipart-1")).ShouldBeTrue();
        (await db.Bibles.SingleAsync(b => b.Id == "bible-1")).VersesJson.ShouldBe("[]");

        // No echo: applying server rows journals nothing
        (await db.SyncJournal.AnyAsync()).ShouldBeFalse();

        // Bases recorded for the pushable roots
        (await db.SyncBase.SingleAsync(b => b.EntityTable == "Songs" && b.RowId == "song-1")).BaseVersion.ShouldBe(V1);
        (await db.SyncBase.AnyAsync(b => b.EntityTable == "Presentations" && b.RowId == "pres-1")).ShouldBeTrue();

        refresher.SongsRefreshed.ShouldBeTrue();
        refresher.BiblesRefreshed.ShouldBeTrue();
    }

    [Fact]
    public async Task ATombstone_CascadesToChildrenAndNullsLabelReferences()
    {
        // Arrange -- pull 1 seeds a presentation with children, and a labelled song part
        server.OnPull = _ => Pull(T1, changes: c =>
        {
            c.SongPartLabels.Add(new SyncSongPartLabelDto("label-1", "Vers", "#123456", 0, T1, V1));
            c.Songs.Add(new SyncSongDto("song-1", "Sången", null, null, null, null, null, T1, V1));
            c.SongParts.Add(new SyncSongPartDto("part-1", "label-1", "Text", 0, "song-1", T1));
            c.Presentations.Add(PresentationDto("pres-1", "Gudstjänst", T1));
            c.PresentationItems.Add(new SyncPresentationItemDto("item-1", null, PresentationItemType.Song, "Titel", null, 0, "pres-1", T1));
            c.PresentationItemParts.Add(new SyncPresentationItemPartDto("ipart-1", "Text", 0, "item-1", T1));
        });
        await engine.SyncAsync();

        // Act -- pull 2 deletes the presentation and the label on the server
        server.OnPull = _ => Pull(T3, tombstones:
        [
            new SyncTombstoneDto(nameof(Presentation), "pres-1", T2),
            new SyncTombstoneDto(nameof(DbSongPartLabel), "label-1", T2),
        ]);
        await engine.SyncAsync();

        // Assert -- children followed the presentation; the part survived with its label nulled
        await using var db = await factory.CreateDbContextAsync();
        (await db.Presentations.AnyAsync()).ShouldBeFalse();
        (await db.PresentationItems.AnyAsync()).ShouldBeFalse();
        (await db.PresentationItemParts.AnyAsync()).ShouldBeFalse();
        (await db.SongParts.SingleAsync(p => p.Id == "part-1")).LabelId.ShouldBeNull();
        (await db.SyncBase.AnyAsync(b => b.RowId == "pres-1")).ShouldBeFalse();
        (await db.SyncJournal.AnyAsync()).ShouldBeFalse("tombstone application must not journal");
    }

    [Fact]
    public async Task RowsEditedWhileThePushIsInFlight_SurviveThePull()
    {
        // Arrange
        server.OnPull = _ => Pull(T1, changes: c =>
        {
            c.Songs.Add(new SyncSongDto("song-1", "Originalet", null, null, null, null, null, T1, V1));
        });
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            (await db.Songs.SingleAsync(s => s.Id == "song-1")).Name = "Lokal ändring";
            await db.SaveChangesAsync();
        }

        // The push is acknowledged, but the user keeps editing while it is in flight...
        server.OnPush = _ =>
        {
            using var db = factory.CreateDbContext();
            db.Songs.Single(s => s.Id == "song-1").Name = "Nyare lokal ändring";
            db.SaveChanges();
            return new SyncPushResponse([
                new SyncPushResult(nameof(DbSong), "song-1", SyncPushOutcome.Applied, NewVersion: V2),
            ]);
        };

        // ...and the pull that follows re-serves the song as the push left it on the server
        server.OnPull = _ => Pull(T3, changes: c =>
        {
            c.Songs.Add(new SyncSongDto("song-1", "Lokal ändring", null, null, null, null, null, T2, V2));
        });

        // Act
        await engine.SyncAsync();

        // Assert -- the in-flight edit was not clobbered, and its base is the acknowledged stamp,
        // so the next push applies cleanly instead of reporting a false conflict
        await using var verify = await factory.CreateDbContextAsync();
        (await verify.Songs.SingleAsync(s => s.Id == "song-1")).Name.ShouldBe("Nyare lokal ändring");
        (await verify.SyncBase.SingleAsync(b => b.RowId == "song-1")).BaseVersion.ShouldBe(V2);
        (await verify.SyncJournal.AnyAsync(j => j.EntityTable == "Songs")).ShouldBeTrue("the in-flight edit still awaits the next push");
    }

    [Fact]
    public async Task ARemappedLabel_IsDroppedLocallyAndHealedByThePull()
    {
        // Arrange -- an offline-created label that collides with one on the server
        server.OnPull = _ => Pull(T1);
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.SongPartLabels.Add(new DbSongPartLabel { Id = "local-label", Text = "Stick", OrganizationId = "org-1" });
            db.Songs.Add(new DbSong
            {
                Id = "song-1", Name = "Sången", OrganizationId = "org-1",
                Parts = { new DbSongPart { Id = "part-1", Content = "Text", LabelId = "local-label" } },
            });
            await db.SaveChangesAsync();
        }

        server.OnPush = _ => new SyncPushResponse([
            new SyncPushResult(nameof(DbSongPartLabel), "local-label", SyncPushOutcome.Remapped, NewId: "server-label"),
            new SyncPushResult(nameof(DbSong), "song-1", SyncPushOutcome.Applied, NewVersion: V2),
        ]);
        server.OnPull = _ => Pull(T3, changes: c =>
        {
            c.SongPartLabels.Add(new SyncSongPartLabelDto("server-label", "Stick", "#654321", 0, T2, V2));
            c.Songs.Add(new SyncSongDto("song-1", "Sången", null, null, null, null, null, T2, V2));
            c.SongParts.Add(new SyncSongPartDto("part-1", "server-label", "Text", 0, "song-1", T2));
        });

        // Act
        await engine.SyncAsync();

        // Assert -- the duplicate is gone and the part points at the server's surviving label
        await using var verify = await factory.CreateDbContextAsync();
        (await verify.SongPartLabels.SingleAsync()).Id.ShouldBe("server-label");
        (await verify.SongParts.SingleAsync(p => p.Id == "part-1")).LabelId.ShouldBe("server-label");
        (await verify.SyncBase.AnyAsync(b => b.RowId == "local-label")).ShouldBeFalse();
    }

    [Fact]
    public async Task AConflict_MakesTheClientAdoptTheServersVersionAndItsNewBase()
    {
        // Without this the device keeps the version the server rejected, with an empty journal and
        // a base that can never match again: invisible, unpushable, and good for one fresh conflict
        // per edit forever. A later pull cannot repair it — the server did not touch the row it
        // kept, so it stays below the watermark.

        // Arrange -- a local presentation the server will answer with its own version of
        server.OnPull = _ => Pull(T1);
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Presentations.Add(new Presentation
            {
                Id = "pres-1", Name = "Min version", OrganizationId = "org-1",
                CreatedBy = "user-1", UpdatedBy = "user-1",
            });
            await db.SaveChangesAsync();
        }

        var serverState = new SyncChanges();
        serverState.Presentations.Add(PresentationDto("pres-1", "Serverns version", T2, V2));

        server.OnPush = _ => new SyncPushResponse([
            new SyncPushResult(nameof(Presentation), "pres-1", SyncPushOutcome.Merged,
                NewVersion: V2, ServerState: serverState),
        ]);
        server.OnPull = _ => Pull(T2);

        // Act
        var summary = await engine.SyncAsync();

        // Assert -- reported to the UI...
        summary.Conflicts.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Merged);

        // ...and the local row now agrees with the server, base included
        await using var verify = await factory.CreateDbContextAsync();
        (await verify.Presentations.SingleAsync(p => p.Id == "pres-1")).Name.ShouldBe("Serverns version");
        (await verify.SyncBase.SingleAsync(b => b.RowId == "pres-1")).BaseVersion.ShouldBe(V2);

        // ...without the adoption looking like a fresh local edit
        (await verify.SyncJournal.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task AFullResync_WipesLocalDataAndReloadsFromScratch()
    {
        // Arrange -- an established watermark and a local song the server no longer serves
        server.OnPull = _ => Pull(T1, changes: c =>
        {
            c.Songs.Add(new SyncSongDto("song-old", "Utgången", null, null, null, null, null, T1, V1));
        });
        await engine.SyncAsync();

        server.OnPull = request => request.Since is null
            ? Pull(T3, changes: c =>
            {
                c.Songs.Add(new SyncSongDto("song-new", "Aktuell", null, null, null, null, null, T2, V2));
            })
            : new SyncPullResponse(T3, RequiresFullResync: true, HasMore: false, NextCursor: null,
                new SyncChanges(), []);

        // Act
        await engine.SyncAsync();

        // Assert
        await using var db = await factory.CreateDbContextAsync();
        (await db.Songs.SingleAsync()).Id.ShouldBe("song-new");
        (await db.SyncBase.SingleAsync(b => b.EntityTable == "Songs")).RowId.ShouldBe("song-new");
    }

    [Fact]
    public async Task CcliEntries_GoToTheDedicatedEndpoint()
    {
        // Arrange
        server.OnPull = _ => Pull(T1);
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.CcliReportEntries.Add(new CcliReportEntry
            {
                Id = "ccli-1", OrganizationId = "org-1", SongId = "song-1", SongName = "Sången",
                CcliNumber = "12345", PresentationName = "Gudstjänst", Date = new DateOnly(2026, 8, 23),
            });
            await db.SaveChangesAsync();
        }

        // Act
        await engine.SyncAsync();

        // Assert
        var entry = server.CcliBatches.ShouldHaveSingleItem().ShouldHaveSingleItem();
        entry.CcliNumber.ShouldBe("12345");
        entry.Date.ShouldBe(new DateOnly(2026, 8, 23));

        await using var verify = await factory.CreateDbContextAsync();
        (await verify.SyncJournal.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task ARevokedToken_SurfacesAsAuthFailure_AndKeepsTheJournal()
    {
        // Arrange
        server.OnPull = _ => Pull(T1);
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Songs.Add(new DbSong { Id = "song-1", Name = "Sång", OrganizationId = "org-1" });
            await db.SaveChangesAsync();
        }

        server.Intercept = _ => new HttpResponseMessage(HttpStatusCode.Unauthorized);

        // Act & Assert
        await Should.ThrowAsync<SyncAuthorizationException>(() => engine.SyncAsync());

        await using var verify = await factory.CreateDbContextAsync();
        (await verify.SyncJournal.AnyAsync()).ShouldBeTrue("nothing may be consumed on a failed push");
    }

    [Fact]
    public async Task TheScheduler_ReportsStatusAndConflicts()
    {
        // Arrange
        server.OnPull = _ => Pull(T1);
        await engine.SyncAsync();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.Presentations.Add(new Presentation
            {
                Id = "pres-1", Name = "Min version", OrganizationId = "org-1",
                CreatedBy = "user-1", UpdatedBy = "user-1",
            });
            await db.SaveChangesAsync();
        }

        server.OnPush = _ => new SyncPushResponse([
            new SyncPushResult(nameof(Presentation), "pres-1", SyncPushOutcome.Merged, NewVersion: V2),
        ]);

        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance);
        var conflicts = new List<SyncPushResult>();
        scheduler.ConflictReported += conflicts.Add;

        // Act
        await scheduler.SyncNowAsync();

        // Assert
        scheduler.Status.ShouldBe(SyncStatus.Idle);
        scheduler.LastSyncAt.ShouldNotBeNull();
        scheduler.PendingChanges.ShouldBe(0);
        conflicts.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Merged);
    }

    [Fact]
    public void TheHostsOwnRegistrations_DisposeTheSchedulerCleanly()
    {
        // The registration shape itself. The desktop registers the scheduler under its own type and
        // again as ISyncStatusSource through a factory returning the same object; the container
        // tracks what a factory returns for disposal without checking whether it already is, so
        // shutdown disposes it twice -- and the second call reached a cancellation source the first
        // had disposed. Closing the app ended in an unhandled ObjectDisposedException.
        var services = new ServiceCollection();
        services.AddSingleton(_ => new SyncScheduler(
            engine, factory, new FakeConnectivityMonitor { IsOnline = true }, auth,
            NullLogger<SyncScheduler>.Instance));
        services.AddSingleton<ISyncStatusSource>(sp => sp.GetRequiredService<SyncScheduler>());

        var provider = services.BuildServiceProvider();
        provider.GetRequiredService<ISyncStatusSource>();

        // Started, because the crash is in the loop's cancellation source and a scheduler that
        // never ran has none to dispose twice -- which is what the desktop does at startup.
        provider.GetRequiredService<SyncScheduler>().Start();

        Should.NotThrow(() => provider.Dispose());
    }

    [Fact]
    public async Task TheScheduler_StaysOfflineWithoutAConnection()
    {
        // Arrange
        var connectivity = new FakeConnectivityMonitor { IsOnline = false };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance);

        // Act
        await scheduler.SyncNowAsync();

        // Assert
        scheduler.Status.ShouldBe(SyncStatus.Offline);
        server.PushRequests.ShouldBeEmpty();
    }

    [Fact]
    public async Task TheScheduler_AnnouncesRemoteChanges_WhenAPullAppliedRows()
    {
        // Arrange
        server.OnPull = _ => Pull(T1, changes: c =>
        {
            c.Songs.Add(new SyncSongDto("song-1", "Serversången", null, null, null, null, null, T1, V1));
        });

        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance);
        var announcements = 0;
        scheduler.RemoteChangesApplied += () => announcements++;

        // Act
        await scheduler.SyncNowAsync();

        // Assert
        announcements.ShouldBe(1);
    }

    [Fact]
    public async Task TheScheduler_SaysNothing_WhenAPullBroughtNoRows()
    {
        // A sync that changed nothing must stay silent, or every view subscribing to this would
        // re-query the database on the poll interval for as long as the app is open.

        // Arrange
        server.OnPull = _ => Pull(T1);

        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance);
        var announcements = 0;
        scheduler.RemoteChangesApplied += () => announcements++;

        // Act
        await scheduler.SyncNowAsync();

        // Assert
        scheduler.Status.ShouldBe(SyncStatus.Idle);
        announcements.ShouldBe(0);
    }

    [Fact]
    public async Task TheScheduler_KeepsAskingTheServer_WithNothingOfItsOwnToSend()
    {
        // The journal poll only ever notices this device's own edits. A device that is merely being
        // read from has an empty journal for hours, and without an idle pull it would never hear
        // about anything anyone else did.

        // Arrange
        var pulls = 0;
        server.OnPull = _ =>
        {
            Interlocked.Increment(ref pulls);
            return Pull(T1);
        };

        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance)
        {
            PollInterval = TimeSpan.FromMilliseconds(20),
            IdlePullInterval = TimeSpan.Zero,
        };

        // Act: Start syncs once immediately, then the loop takes over.
        scheduler.Start();
        await WaitUntil(() => Volatile.Read(ref pulls) >= 3);

        // Assert
        Volatile.Read(ref pulls).ShouldBeGreaterThanOrEqualTo(3);
        await using var db = await factory.CreateDbContextAsync();
        (await db.SyncJournal.CountAsync()).ShouldBe(0, "the pulls must not be driven by local edits");
    }

    // --- The local write signal ---

    [Fact]
    public async Task ALocalWrite_SyncsWithoutWaitingForThePoll()
    {
        // Arrange -- a poll far enough out that anything happening inside the wait is the signal's
        // doing and nothing else.
        var pushes = 0;
        server.OnPush = _ =>
        {
            Interlocked.Increment(ref pushes);
            return new SyncPushResponse([]);
        };

        var writes = new LocalWriteSignal();
        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance, mediaSynchronizer: null, localWrites: writes)
        {
            PollInterval = TimeSpan.FromMinutes(5),
            IdlePullInterval = TimeSpan.FromMinutes(5),
            WriteSignalDelay = TimeSpan.FromMilliseconds(50),
        };
        scheduler.Start();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.OverlaySlides.Add(new OverlaySlide { Id = "overlay-1", Title = "Info", OrganizationId = "org-1" });
            await db.SaveChangesAsync();
        }

        // Act
        writes.Raise();

        // Assert
        await WaitUntil(() => Volatile.Read(ref pushes) >= 1);
    }

    [Fact]
    public async Task ABurstOfWrites_BecomesOneSync()
    {
        // Saving a presentation touches a dozen rows and every one of them raises the signal.
        var pushes = 0;
        server.OnPush = _ =>
        {
            Interlocked.Increment(ref pushes);
            return new SyncPushResponse([]);
        };

        var writes = new LocalWriteSignal();
        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance, mediaSynchronizer: null, localWrites: writes)
        {
            PollInterval = TimeSpan.FromMinutes(5),
            IdlePullInterval = TimeSpan.FromMinutes(5),
            WriteSignalDelay = TimeSpan.FromMilliseconds(300),
        };
        scheduler.Start();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.OverlaySlides.Add(new OverlaySlide { Id = "overlay-1", Title = "Info", OrganizationId = "org-1" });
            await db.SaveChangesAsync();
        }

        // Act
        for (var i = 0; i < 50; i++)
            writes.Raise();

        // Assert
        await WaitUntil(() => Volatile.Read(ref pushes) >= 1);
        Volatile.Read(ref pushes).ShouldBe(1);
    }

    [Fact]
    public async Task ASteadyStreamOfSignals_DoesNotHoldAWriteHostage()
    {
        // Why the wait is a maximum rather than a restarting debounce. The signal is raised by every
        // database command, reads included, so a screen that queries steadily would keep resetting a
        // restarting one and the write would sit unsent until the poll noticed it -- slow, and slow
        // in a way that depends on which page happens to be open.
        var start = DateTimeOffset.UtcNow;
        DateTimeOffset? firstPushAt = null;
        server.OnPush = _ =>
        {
            firstPushAt ??= DateTimeOffset.UtcNow;
            return new SyncPushResponse([]);
        };

        var writes = new LocalWriteSignal();
        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance, mediaSynchronizer: null, localWrites: writes)
        {
            PollInterval = TimeSpan.FromMinutes(5),
            IdlePullInterval = TimeSpan.FromMinutes(5),
            WriteSignalDelay = TimeSpan.FromMilliseconds(100),
        };
        scheduler.Start();

        await using (var db = await factory.CreateDbContextAsync())
        {
            db.OverlaySlides.Add(new OverlaySlide { Id = "overlay-1", Title = "Info", OrganizationId = "org-1" });
            await db.SaveChangesAsync();
        }

        // Act -- an unbroken stream, closer together than the wait, for ten times its length.
        var streamStarted = DateTimeOffset.UtcNow;
        var stop = streamStarted.AddSeconds(1);
        while (DateTimeOffset.UtcNow < stop)
        {
            writes.Raise();
            await Task.Delay(10);
        }

        // Assert -- it pushed while the stream was still running. A restarting debounce would not
        // have fired until after the last signal, which is what this measures.
        await WaitUntil(() => firstPushAt is not null);
        firstPushAt!.Value.ShouldBeLessThan(streamStarted.AddMilliseconds(600),
            "the write must not wait for the stream to stop");
        firstPushAt.Value.ShouldBeGreaterThanOrEqualTo(start);
    }

    [Fact]
    public async Task ASignalWithNothingJournalled_DoesNotReachTheServer()
    {
        // Every command raises the signal, reads included — and a sync reads the database, so a
        // signal answered with a pull makes the sync feed itself. On a real device that was 59
        // pulls in 60 idle seconds, for ever. A signal is about getting local work up; when there
        // is none, the answer is a journal read and nothing more.
        var requests = 0;
        server.OnPull = _ =>
        {
            Interlocked.Increment(ref requests);
            return Pull(T1);
        };
        server.OnPush = _ =>
        {
            Interlocked.Increment(ref requests);
            return new SyncPushResponse([]);
        };

        var writes = new LocalWriteSignal();
        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance, mediaSynchronizer: null, localWrites: writes)
        {
            PollInterval = TimeSpan.FromMinutes(5),
            IdlePullInterval = TimeSpan.FromMinutes(5),
            WriteSignalDelay = TimeSpan.FromMilliseconds(50),
        };

        // Started, and its opening sync allowed to finish: an unstarted scheduler is subscribed to
        // nothing, so this measured nothing at all until a real device showed the loop.
        scheduler.Start();
        await WaitUntil(() => scheduler.LastSyncAt is not null);
        var afterStart = Volatile.Read(ref requests);

        // Act -- signals with an empty journal, as the scheduler's own reads produce.
        for (var i = 0; i < 20; i++)
        {
            writes.Raise();
            await Task.Delay(25);
        }
        await Task.Delay(300);

        Volatile.Read(ref requests).ShouldBe(afterStart, "an empty journal is not worth a request");
    }

    [Fact]
    public async Task AnExecuteUpdate_WakesTheSyncThroughTheInterceptor()
    {
        // The reason the signal is a command interceptor rather than a hook on SaveChanges. Renaming
        // a presentation, an item, a theme, an event date or an output all go through ExecuteUpdate,
        // which exists to bypass the change tracker -- so a SaveChanges hook would never see them
        // and those edits alone would wait out the poll.
        var pushes = 0;
        server.OnPush = _ =>
        {
            Interlocked.Increment(ref pushes);
            return new SyncPushResponse([]);
        };

        var writes = new LocalWriteSignal();
        IDbContextFactory<ClientDataContext> intercepted = new TestDbContextFactory(
            new DbContextOptionsBuilder<ClientDataContext>()
                .UseSqlite(connection)
                .AddInterceptors(new LocalWriteInterceptor(writes))
                .Options);

        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance, mediaSynchronizer: null, localWrites: writes)
        {
            PollInterval = TimeSpan.FromMinutes(5),
            IdlePullInterval = TimeSpan.FromMinutes(5),
            WriteSignalDelay = TimeSpan.FromMilliseconds(50),
        };

        // Started first: its opening sync is what creates the organisation and user rows the
        // presentation's foreign keys need.
        scheduler.Start();
        await WaitUntil(() => scheduler.LastSyncAt is not null);

        // Seeded through the unintercepted factory, so nothing here raises the signal and the only
        // thing that can wake the sync below is the ExecuteUpdate itself.
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Presentations.Add(new Presentation
            {
                Id = "pres-1", Name = "Gudstjänst", OrganizationId = "org-1",
                CreatedBy = "user-1", UpdatedBy = "user-1",
            });
            await seed.SaveChangesAsync();
        }
        var before = Volatile.Read(ref pushes);

        // Act -- no SaveChanges anywhere in this.
        await using (var db = await intercepted.CreateDbContextAsync())
        {
            await db.Presentations
                .Where(p => p.Id == "pres-1")
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.Name, "Omdöpt")
                    .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow));
        }

        // Assert
        await WaitUntil(() => Volatile.Read(ref pushes) > before);
    }

    [Fact]
    public async Task AWriteTheSignalMissed_SyncsOnTheNextTickAndNotTheOneAfter()
    {
        // The poll is the backstop. It used to spend one whole tick noticing an edit and only push
        // on the next, which made the backstop twice as slow as it needed to be; the coalescing that
        // justified it now lives in the write signal's wait.
        var pushes = 0;
        server.OnPush = _ =>
        {
            Interlocked.Increment(ref pushes);
            return new SyncPushResponse([]);
        };

        var connectivity = new FakeConnectivityMonitor { IsOnline = true };
        using var scheduler = new SyncScheduler(engine, factory, connectivity, auth,
            NullLogger<SyncScheduler>.Instance)
        {
            PollInterval = TimeSpan.FromMilliseconds(50),
            IdlePullInterval = TimeSpan.FromMinutes(5),
        };
        scheduler.Start();
        await WaitUntil(() => scheduler.LastSyncAt is not null);

        // A write with no signal behind it: exactly what a path the interceptor never saw looks like.
        await using (var db = await factory.CreateDbContextAsync())
        {
            db.OverlaySlides.Add(new OverlaySlide { Id = "overlay-1", Title = "Info", OrganizationId = "org-1" });
            await db.SaveChangesAsync();
        }
        var before = Volatile.Read(ref pushes);

        await WaitUntil(() => Volatile.Read(ref pushes) > before);
    }

    /// <summary>
    /// Polls a condition to a deadline rather than sleeping for a fixed time: the loop under test is
    /// driven by a timer, and a fixed sleep is either flaky or slow.
    /// </summary>
    private static async Task WaitUntil(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!condition())
        {
            timeout.Token.ThrowIfCancellationRequested();
            await Task.Delay(10, timeout.Token);
        }
    }

    private static SyncPresentationDto PresentationDto(string id, string name, DateTimeOffset modifiedAt, long version = V1) =>
        new(id, name, T1, "user-1", T1, "user-1", false, null, null, 0, null, null, null, null, null, null, modifiedAt, version);

    /// <summary>A single-page pull response.</summary>
    private static SyncPullResponse Pull(
        DateTimeOffset watermark, Action<SyncChanges>? changes = null, List<SyncTombstoneDto>? tombstones = null)
    {
        var syncChanges = new SyncChanges();
        changes?.Invoke(syncChanges);
        return new SyncPullResponse(watermark, RequiresFullResync: false, HasMore: false,
            NextCursor: null, syncChanges, tombstones ?? []);
    }

    private class TestDbContextFactory(DbContextOptions<ClientDataContext> options)
        : IDbContextFactory<ClientDataContext>
    {
        public ClientDataContext CreateDbContext() => new(options);
    }

    private class FakeCacheRefresher : ISyncCacheRefresher
    {
        public bool SongsRefreshed { get; private set; }
        public bool BiblesRefreshed { get; private set; }

        public Task RefreshSongsAsync()
        {
            SongsRefreshed = true;
            return Task.CompletedTask;
        }

        public Task RefreshBiblesAsync()
        {
            BiblesRefreshed = true;
            return Task.CompletedTask;
        }
    }

    private class FakeConnectivityMonitor : IConnectivityMonitor
    {
        public bool IsOnline { get; set; }
        public event Action? Changed { add { } remove { } }
    }

    private class FakeSecureTokenStore : ISecureTokenStore
    {
        private string? token;

        public Task<string?> GetTokenAsync() => Task.FromResult(token);

        public Task SetTokenAsync(string value)
        {
            token = value;
            return Task.CompletedTask;
        }

        public Task RemoveTokenAsync()
        {
            token = null;
            return Task.CompletedTask;
        }
    }

    /// <summary>The server, as far as the engine can tell: three endpoints behind HttpClient.</summary>
    private class FakeSyncServer : HttpMessageHandler
    {
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        public List<SyncPushRequest> PushRequests { get; } = [];
        public List<List<CcliSyncEntry>> CcliBatches { get; } = [];
        public Func<SyncPushRequest, SyncPushResponse> OnPush { get; set; } = _ => new SyncPushResponse([]);
        public Func<SyncPullRequest, SyncPullResponse> OnPull { get; set; } =
            _ => new SyncPullResponse(DateTimeOffset.UnixEpoch, false, false, null, new SyncChanges(), []);

        /// <summary>When set and returning non-null, short-circuits the request (e.g. a 401).</summary>
        public Func<HttpRequestMessage, HttpResponseMessage?>? Intercept { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (Intercept?.Invoke(request) is { } intercepted)
                return intercepted;

            var body = await request.Content!.ReadAsStringAsync(cancellationToken);
            switch (request.RequestUri!.AbsolutePath)
            {
                case "/api/sync/push":
                {
                    var push = JsonSerializer.Deserialize<SyncPushRequest>(body, Json)!;
                    PushRequests.Add(push);
                    return JsonResponse(OnPush(push));
                }
                case "/api/sync/pull":
                {
                    var pull = JsonSerializer.Deserialize<SyncPullRequest>(body, Json)!;
                    return JsonResponse(OnPull(pull));
                }
                case "/api/sync/ccli-reports":
                {
                    var entries = JsonSerializer.Deserialize<List<CcliSyncEntry>>(body, Json)!;
                    CcliBatches.Add(entries);
                    return JsonResponse(new { Recorded = entries.Count });
                }
                default:
                    return new HttpResponseMessage(HttpStatusCode.NotFound);
            }
        }

        private static HttpResponseMessage JsonResponse<T>(T payload) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, Json), System.Text.Encoding.UTF8, "application/json"),
        };
    }
}
