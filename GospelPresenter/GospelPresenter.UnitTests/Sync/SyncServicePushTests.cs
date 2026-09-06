using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// Covers the push half of the sync protocol: clean applies with client-minted ids, and every
/// agreed conflict policy — the server wins, a losing presentation becomes an "(offline changes)"
/// copy, a losing song goes into version history, label text collisions remap, and an offline
/// delete never beats a server-side edit.
/// </summary>
public class SyncServicePushTests : IDisposable
{
    private static readonly DateTimeOffset Past = DateTimeOffset.UtcNow.AddHours(-2);

    /// <summary>A version no row will ever have: the trigger starts at 1 and only counts up.</summary>
    private const long StaleVersion = -1;
    private const string Suffix = SyncServiceFactory.OfflineSuffix;

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly SyncService service;
    private readonly Organization org;
    private readonly CallerContext caller;

    public SyncServicePushTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);

        service = SyncServiceFactory.Create(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = "Org" };
        context.Organizations.Add(org);
        context.Users.Add(new User { Id = "user-1", Name = "Anna", Email = "anna@example.com", OrganizationId = org.Id });
        context.SaveChanges();

        caller = new CallerContext("user-1", UserRole.Admin, org.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task Push_ANewSongAggregate_InsertsItWithTheClientsIds()
    {
        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Songs =
            [
                new SyncSongPush(
                    NewSongDto("song-1", "Ny sång"),
                    [new SyncSongPartDto("part-1", null, "Vers ett", 0, "song-1", default)],
                    [new SyncSongArrangementDto("arr-1", "Live", """["part-1"]""", "song-1", default)],
                    BaseVersion: null)
            ]
        }, caller);

        // Assert
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Songs.Include(s => s.Parts).Include(s => s.Arrangements).SingleAsync();
        stored.Id.ShouldBe("song-1");
        stored.Parts.ShouldHaveSingleItem().Id.ShouldBe("part-1");
        stored.Arrangements.ShouldHaveSingleItem().Id.ShouldBe("arr-1");
        stored.ModifiedAt.ShouldBeGreaterThan(Past);

        // The client stores this as its new conflict base, so it must equal the value the database
        // holds — the same value the next base comparison reads.
        result.NewVersion.ShouldBe(stored.Version);
    }

    [Fact]
    public async Task Push_ASongWithAMatchingBase_AppliesChildChangesIncludingRemovals()
    {
        // Arrange
        var baseVersion = await SeedSongAsync();

        // Act -- the pushed aggregate renames the song, drops part-1 and adds part-2
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Songs =
            [
                new SyncSongPush(
                    NewSongDto("song-1", "Nytt namn"),
                    [new SyncSongPartDto("part-2", null, "Ny vers", 0, "song-1", default)],
                    [],
                    baseVersion)
            ]
        }, caller);

        // Assert
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Songs.Include(s => s.Parts).SingleAsync();
        stored.Name.ShouldBe("Nytt namn");
        stored.Parts.ShouldHaveSingleItem().Id.ShouldBe("part-2");
        result.NewVersion.ShouldBe(stored.Version, "the client's next base must match the stored stamp");

        // The removed part leaves a tombstone so other clients learn about it.
        var tombstone = await context.SyncTombstones.SingleAsync(t => t.EntityType == nameof(DbSongPart));
        tombstone.EntityId.ShouldBe("part-1");
    }

    [Fact]
    public async Task Push_ASongWithAStaleBase_KeepsTheServerVersionAndSnapshotsThePushedState()
    {
        // Arrange
        await SeedSongAsync();

        // Act -- the base does not match the server's ModifiedAt
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Songs =
            [
                new SyncSongPush(
                    NewSongDto("song-1", "Offlineversionen"),
                    [new SyncSongPartDto("part-9", null, "Offline text", 0, "song-1", default)],
                    [],
                    BaseVersion: StaleVersion)
            ]
        }, caller);

        // Assert
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.ServerWins);
        await using var context = await factory.CreateDbContextAsync();
        (await context.Songs.SingleAsync()).Name.ShouldBe("Originalet");

        // The offline work survives in the song's version history.
        var version = await context.SongVersions.SingleAsync();
        version.SongId.ShouldBe("song-1");
        version.Name.ShouldBe("Offlineversionen");
        version.PartsJson.ShouldContain("Offline text");
    }

    [Fact]
    public async Task Push_ALabelWhoseTextAlreadyExists_RemapsReferencesInTheSameBatch()
    {
        // Arrange -- the server already has a "Vers" label under another id
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.SongPartLabels.Add(new DbSongPartLabel { Id = "server-label", Text = "Vers", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }

        // Act -- the client invented its own "Vers" label offline and a song referencing it
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            SongPartLabels =
            [
                new SyncRowPush<SyncSongPartLabelDto>(
                    new SyncSongPartLabelDto("client-label", "Vers", "#123456", 0, default, 0), null)
            ],
            Songs =
            [
                new SyncSongPush(
                    NewSongDto("song-1", "Ny sång"),
                    [new SyncSongPartDto("part-1", "client-label", "Text", 0, "song-1", default)],
                    [],
                    null)
            ]
        }, caller);

        // Assert
        var labelResult = response.Results.Single(r => r.EntityType == nameof(DbSongPartLabel));
        labelResult.Outcome.ShouldBe(SyncPushOutcome.Remapped);
        labelResult.NewId.ShouldBe("server-label");

        await using var context = await factory.CreateDbContextAsync();
        (await context.SongParts.SingleAsync()).LabelId.ShouldBe("server-label");
        (await context.SongPartLabels.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Push_ANewPresentation_InsertsItWithTheClientsIds()
    {
        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Presentations =
            [
                new SyncPresentationPush(
                    NewPresentationDto("pres-1", "Gudstjänst"),
                    [new SyncPresentationItemDto("item-1", null, PresentationItemType.Song, "Sång", null, 0, "pres-1", default)],
                    [new SyncPresentationItemPartDto("part-1", "Text", 0, "item-1", default)],
                    [],
                    null)
            ]
        }, caller);

        // Assert
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Presentations.Include(p => p.Items).ThenInclude(i => i.Parts).SingleAsync();
        stored.Id.ShouldBe("pres-1");
        stored.CreatedBy.ShouldBe("user-1");
        stored.Items.ShouldHaveSingleItem().Parts.ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Push_APresentationBothSidesChanged_CombinesTheItemsInsteadOfDuplicatingIt()
    {
        // The point of merging: the ordinary "conflict" is one person adding a song while another
        // renames the service, and neither of them should have to lose anything or end up looking
        // at two nearly identical presentations.

        // Arrange -- the server's copy already has an item the client has never seen
        await SeedPresentationAsync();
        await using (var seed = await factory.CreateDbContextAsync())
        {
            var presentation = await seed.Presentations.SingleAsync(p => p.Id == "pres-1");
            presentation.Items.Add(new PresentationItem
            {
                Id = "server-item", Type = PresentationItemType.Song, Title = "Serverns sång", SortOrder = 1,
            });
            await seed.SaveChangesAsync();
        }

        // Act -- the client pushes its own item against a base that no longer matches
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Presentations =
            [
                new SyncPresentationPush(
                    NewPresentationDto("pres-1", "Offlineversionen"),
                    [new SyncPresentationItemDto("client-item", null, PresentationItemType.Song, "Offline-sång", null, 0, "pres-1", default)],
                    [new SyncPresentationItemPartDto("part-1", "Offline text", 0, "client-item", default)],
                    [],
                    BaseVersion: StaleVersion)
            ]
        }, caller);

        // Assert -- one presentation, both items
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.Merged);

        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Presentations
            .Include(p => p.Items).ThenInclude(i => i.Parts)
            .SingleAsync();
        stored.Id.ShouldBe("pres-1");
        stored.Items.Select(i => i.Id).OrderBy(id => id)
            .ShouldBe(["client-item", "server-item"]);
        stored.Items.Single(i => i.Id == "client-item").Parts
            .ShouldHaveSingleItem().Content.ShouldBe("Offline text");

        // The pushed presentation carries the default (earliest) ModifiedAt, so per-row last-writer
        // -wins keeps the server's name. The items are unaffected: they are merged by identity, not
        // by whose presentation is newer.
        stored.Name.ShouldBe("Originalet");

        // And the client is handed the combined result, since it matches neither side.
        var state = result.ServerState.ShouldNotBeNull();
        state.Presentations.ShouldHaveSingleItem().Version.ShouldBe(stored.Version);
        state.PresentationItems.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Push_APresentationDeletedOnTheServer_StaysDeleted()
    {
        // Deletion is a decision someone made. Merging cannot apply — there is nothing to merge
        // with — and resurrecting it under a new name is exactly the clutter this policy removed.

        // Act -- BaseVersion says the client believed the presentation existed
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Presentations =
            [
                new SyncPresentationPush(
                    NewPresentationDto("gone-pres", "Redigerad offline"),
                    [], [], [],
                    BaseVersion: StaleVersion)
            ]
        }, caller);

        // Assert
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.ServerWins);
        result.ServerState.ShouldBeNull("there is no server version to adopt");
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task Push_ADeleteWithAStaleBase_IsRejected()
    {
        // Arrange -- the server row changed after the client went offline
        await SeedPresentationAsync();

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Deletes = [new SyncDeletePush(nameof(Presentation), "pres-1", StaleVersion)]
        }, caller);

        // Assert -- a server-side edit beats an offline delete
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.ServerWins);
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == "pres-1")).ShouldBeTrue();
    }

    [Fact]
    public async Task Push_ADeleteWithAMatchingBase_TrashesThePresentation()
    {
        // Arrange
        var baseVersion = await SeedPresentationAsync();

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Deletes = [new SyncDeletePush(nameof(Presentation), "pres-1", baseVersion)]
        }, caller);

        // Assert -- a delete made offline lands in the trash, the same as one made here, so it is
        // recoverable from any device rather than only from the one that made it.
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.SingleAsync(p => p.Id == "pres-1")).DeletedAt.ShouldNotBeNull();
        (await context.SyncTombstones.AnyAsync(t => t.EntityType == nameof(Presentation))).ShouldBeFalse();
    }

    [Fact]
    public async Task Push_AUserSettingWhoseKeyExistsUnderAnotherId_UpdatesThatRowAndRemaps()
    {
        // Arrange
        long baseVersion;
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.UserSettings.Add(new UserSetting { Id = "server-id", UserId = "user-1", Key = "Language", Value = "en" });
            await seed.SaveChangesAsync();
        }
        await using (var read = await factory.CreateDbContextAsync())
        {
            baseVersion = (await read.UserSettings.SingleAsync()).Version;
        }

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            UserSettings =
            [
                new SyncRowPush<SyncUserSettingDto>(
                    new SyncUserSettingDto("client-id", "Language", "sv", default, 0), baseVersion)
            ]
        }, caller);

        // Assert
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.Remapped);
        result.NewId.ShouldBe("server-id");
        await using var context = await factory.CreateDbContextAsync();
        (await context.UserSettings.SingleAsync()).Value.ShouldBe("sv");
    }

    [Fact]
    public async Task Push_AnOrganizationSettingWithoutTheManagePermission_Fails()
    {
        // Act -- plain users cannot write organisation settings, offline or not
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            OrganizationSettings =
            [
                new SyncRowPush<SyncOrganizationSettingDto>(
                    new SyncOrganizationSettingDto("os-1", "DefaultThemeId", "classic", default, 0), null)
            ]
        }, new CallerContext("user-1", UserRole.User, org.Id));

        // Assert
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Failed);
    }

    [Fact]
    public async Task Push_AnInvalidAggregate_FailsAloneWithoutTakingTheBatchDown()
    {
        // Act -- the song violates a length constraint; the label is fine
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            SongPartLabels =
            [
                new SyncRowPush<SyncSongPartLabelDto>(
                    new SyncSongPartLabelDto("label-1", "Vers", "#123456", 0, default, 0), null)
            ],
            Songs =
            [
                new SyncSongPush(
                    NewSongDto("song-1", new string('x', 5000)),
                    [], [],
                    null)
            ]
        }, caller);

        // Assert
        response.Results.Single(r => r.EntityType == nameof(DbSongPartLabel)).Outcome.ShouldBe(SyncPushOutcome.Applied);
        var failed = response.Results.Single(r => r.EntityType == nameof(DbSong));
        failed.Outcome.ShouldBe(SyncPushOutcome.Failed);
        failed.Warning.ShouldNotBeNull();
        await using var context = await factory.CreateDbContextAsync();
        (await context.Songs.AnyAsync()).ShouldBeFalse();
        (await context.SongPartLabels.AnyAsync()).ShouldBeTrue();
    }

    // --- Helpers ---

    private static SyncSongDto NewSongDto(string id, string name) =>
        new(id, name, null, null, null, null, null, default, 0);

    private static SyncPresentationDto NewPresentationDto(string id, string name) =>
        new(id, name, default, "", default, "", false, null, null, 0, null, null, null, null, null, null, null, default, 0);

    private async Task<long> SeedSongAsync()
    {
        await using (var seed = await factory.CreateDbContextAsync())
        {
            var song = new DbSong { Id = "song-1", Name = "Originalet", OrganizationId = org.Id };
            song.Parts.Add(new DbSongPart { Id = "part-1", Content = "Serverns text", SortOrder = 0 });
            seed.Songs.Add(song);
            await seed.SaveChangesAsync();
        }

        // A real client learns the base from a pull, so the test reads it back the same way rather
        // than assuming what the trigger assigned.
        await using var context = await factory.CreateDbContextAsync();
        return (await context.Songs.SingleAsync(s => s.Id == "song-1")).Version;
    }

    private async Task<long> SeedPresentationAsync()
    {
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Presentations.Add(new Presentation { Id = "pres-1", Name = "Originalet", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }

        await using var context = await factory.CreateDbContextAsync();
        return (await context.Presentations.SingleAsync(p => p.Id == "pres-1")).Version;
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

}
