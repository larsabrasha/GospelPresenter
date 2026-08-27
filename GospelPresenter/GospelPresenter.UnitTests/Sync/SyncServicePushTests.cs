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
                    BaseModifiedAt: null)
            ]
        }, caller);

        // Assert
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Songs.Include(s => s.Parts).Include(s => s.Arrangements).SingleAsync();
        stored.Id.ShouldBe("song-1");
        stored.Parts.ShouldHaveSingleItem().Id.ShouldBe("part-1");
        stored.Arrangements.ShouldHaveSingleItem().Id.ShouldBe("arr-1");
        stored.ModifiedAt.ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task Push_ASongWithAMatchingBase_AppliesChildChangesIncludingRemovals()
    {
        // Arrange
        var baseModifiedAt = await SeedSongAsync();

        // Act -- the pushed aggregate renames the song, drops part-1 and adds part-2
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Songs =
            [
                new SyncSongPush(
                    NewSongDto("song-1", "Nytt namn"),
                    [new SyncSongPartDto("part-2", null, "Ny vers", 0, "song-1", default)],
                    [],
                    baseModifiedAt)
            ]
        }, caller);

        // Assert
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Songs.Include(s => s.Parts).SingleAsync();
        stored.Name.ShouldBe("Nytt namn");
        stored.Parts.ShouldHaveSingleItem().Id.ShouldBe("part-2");

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
                    BaseModifiedAt: Past)
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
                    new SyncSongPartLabelDto("client-label", "Vers", "#123456", 0, default), null)
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
    public async Task Push_APresentationWithAStaleBase_KeepsTheServerVersionAndSavesACopy()
    {
        // Arrange
        await SeedPresentationAsync();

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Presentations =
            [
                new SyncPresentationPush(
                    NewPresentationDto("pres-1", "Offlineversionen"),
                    [new SyncPresentationItemDto("item-1", null, PresentationItemType.Song, "Offline-sång", null, 0, "pres-1", default)],
                    [new SyncPresentationItemPartDto("part-1", "Offline text", 0, "item-1", default)],
                    [],
                    BaseModifiedAt: Past)
            ]
        }, caller);

        // Assert
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.CopiedAsNew);
        result.NewId.ShouldNotBeNull();

        await using var context = await factory.CreateDbContextAsync();
        var original = await context.Presentations.SingleAsync(p => p.Id == "pres-1");
        original.Name.ShouldBe("Originalet");

        var copy = await context.Presentations.Include(p => p.Items).ThenInclude(i => i.Parts)
            .SingleAsync(p => p.Id == result.NewId);
        copy.Name.ShouldBe($"Offlineversionen {Suffix}");
        var copiedItem = copy.Items.ShouldHaveSingleItem();
        copiedItem.Id.ShouldNotBe("item-1");
        copiedItem.Parts.ShouldHaveSingleItem().Content.ShouldBe("Offline text");
    }

    [Fact]
    public async Task Push_APresentationDeletedOnTheServer_SavesACopyInsteadOfResurrecting()
    {
        // Act -- BaseModifiedAt says the client believed the presentation existed
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Presentations =
            [
                new SyncPresentationPush(
                    NewPresentationDto("gone-pres", "Redigerad offline"),
                    [], [], [],
                    BaseModifiedAt: Past)
            ]
        }, caller);

        // Assert
        var result = response.Results.ShouldHaveSingleItem();
        result.Outcome.ShouldBe(SyncPushOutcome.CopiedAsNew);
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.SingleAsync()).Id.ShouldBe(result.NewId);
    }

    [Fact]
    public async Task Push_ADeleteWithAStaleBase_IsRejected()
    {
        // Arrange -- the server row changed after the client went offline
        await SeedPresentationAsync();

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Deletes = [new SyncDeletePush(nameof(Presentation), "pres-1", Past)]
        }, caller);

        // Assert -- a server-side edit beats an offline delete
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.ServerWins);
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == "pres-1")).ShouldBeTrue();
    }

    [Fact]
    public async Task Push_ADeleteWithAMatchingBase_DeletesAndTombstones()
    {
        // Arrange
        var baseModifiedAt = await SeedPresentationAsync();

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            Deletes = [new SyncDeletePush(nameof(Presentation), "pres-1", baseModifiedAt)]
        }, caller);

        // Assert
        response.Results.ShouldHaveSingleItem().Outcome.ShouldBe(SyncPushOutcome.Applied);
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync()).ShouldBeFalse();
        (await context.SyncTombstones.SingleAsync(t => t.EntityType == nameof(Presentation)))
            .EntityId.ShouldBe("pres-1");
    }

    [Fact]
    public async Task Push_AUserSettingWhoseKeyExistsUnderAnotherId_UpdatesThatRowAndRemaps()
    {
        // Arrange
        DateTimeOffset baseModifiedAt;
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.UserSettings.Add(new UserSetting { Id = "server-id", UserId = "user-1", Key = "Language", Value = "en" });
            await seed.SaveChangesAsync();
        }
        await using (var read = await factory.CreateDbContextAsync())
        {
            baseModifiedAt = (await read.UserSettings.SingleAsync()).ModifiedAt;
        }

        // Act
        var response = await service.PushAsync(org.Id, new SyncPushRequest
        {
            UserSettings =
            [
                new SyncRowPush<SyncUserSettingDto>(
                    new SyncUserSettingDto("client-id", "Language", "sv", default), baseModifiedAt)
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
                    new SyncOrganizationSettingDto("os-1", "DefaultThemeId", "classic", default), null)
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
                    new SyncSongPartLabelDto("label-1", "Vers", "#123456", 0, default), null)
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
        new(id, name, null, null, null, null, null, default);

    private static SyncPresentationDto NewPresentationDto(string id, string name) =>
        new(id, name, default, "", default, "", false, null, null, 0, null, null, null, null, null, null, default);

    private async Task<DateTimeOffset> SeedSongAsync()
    {
        await using (var seed = await factory.CreateDbContextAsync())
        {
            var song = new DbSong { Id = "song-1", Name = "Originalet", OrganizationId = org.Id };
            song.Parts.Add(new DbSongPart { Id = "part-1", Content = "Serverns text", SortOrder = 0 });
            seed.Songs.Add(song);
            await seed.SaveChangesAsync();
        }

        // A real client learns the base from a pull, i.e. after the database's round-trip
        // (SQLite stores milliseconds), so the test must read it back the same way.
        await using var context = await factory.CreateDbContextAsync();
        return (await context.Songs.SingleAsync(s => s.Id == "song-1")).ModifiedAt;
    }

    private async Task<DateTimeOffset> SeedPresentationAsync()
    {
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Presentations.Add(new Presentation { Id = "pres-1", Name = "Originalet", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }

        await using var context = await factory.CreateDbContextAsync();
        return (await context.Presentations.SingleAsync(p => p.Id == "pres-1")).ModifiedAt;
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

}
