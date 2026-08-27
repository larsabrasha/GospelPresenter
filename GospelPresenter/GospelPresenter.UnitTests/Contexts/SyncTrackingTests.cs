using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Contexts;

/// <summary>
/// Covers the sync tracking that PresentationContext performs on every save: stamping
/// <see cref="ISyncTracked.ModifiedAt"/> on inserts and updates, and writing tombstones for
/// tracked deletes — including resolving the organisation through the parent for child rows,
/// and skipping child tombstones when the parent dies in the same save.
/// </summary>
public class SyncTrackingTests : IDisposable
{
    private static readonly DateTimeOffset Past = DateTimeOffset.UtcNow.AddHours(-1);

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly Organization org;

    public SyncTrackingTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = "Org" };
        context.Organizations.Add(org);
        context.SaveChanges();
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task SaveChangesAsync_WhenInsertingASyncedEntity_StampsModifiedAt()
    {
        // Act
        await using var context = await factory.CreateDbContextAsync();
        context.Songs.Add(new DbSong { Id = "song-1", Name = "Amazing Grace", OrganizationId = org.Id });
        await context.SaveChangesAsync();

        // Assert
        var stored = await context.Songs.SingleAsync(s => s.Id == "song-1");
        stored.ModifiedAt.ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task SaveChangesAsync_WhenUpdatingASyncedEntity_RestampsModifiedAt()
    {
        // Arrange
        await SeedSongAsync("song-1");
        await BackdateAsync<DbSong>("song-1");

        // Act
        await using var context = await factory.CreateDbContextAsync();
        var song = await context.Songs.SingleAsync(s => s.Id == "song-1");
        song.Name = "New name";
        await context.SaveChangesAsync();

        // Assert
        song.ModifiedAt.ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task SaveChangesAsync_WhenDeletingAnOrganizationScopedEntity_WritesATombstoneWithTheOrganization()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.SongPartLabels.Add(new DbSongPartLabel { Id = "label-1", Text = "Vers", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }

        // Act
        await using var context = await factory.CreateDbContextAsync();
        var label = await context.SongPartLabels.SingleAsync(l => l.Id == "label-1");
        context.SongPartLabels.Remove(label);
        await context.SaveChangesAsync();

        // Assert
        var tombstone = await context.SyncTombstones.SingleAsync();
        tombstone.EntityType.ShouldBe(nameof(DbSongPartLabel));
        tombstone.EntityId.ShouldBe("label-1");
        tombstone.OrganizationId.ShouldBe(org.Id);
        tombstone.UserId.ShouldBeNull();
        tombstone.DeletedAt.ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task SaveChangesAsync_WhenDeletingAUserSetting_WritesATombstoneWithTheUser()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Users.Add(new User { Id = "user-1", Name = "Anna", Email = "anna@example.com", OrganizationId = org.Id });
            seed.UserSettings.Add(new UserSetting { Id = "setting-1", UserId = "user-1", Key = "k", Value = "v" });
            await seed.SaveChangesAsync();
        }

        // Act
        await using var context = await factory.CreateDbContextAsync();
        var setting = await context.UserSettings.SingleAsync(s => s.Id == "setting-1");
        context.UserSettings.Remove(setting);
        await context.SaveChangesAsync();

        // Assert
        var tombstone = await context.SyncTombstones.SingleAsync();
        tombstone.EntityType.ShouldBe(nameof(UserSetting));
        tombstone.UserId.ShouldBe("user-1");
        tombstone.OrganizationId.ShouldBeNull();
    }

    [Fact]
    public async Task SaveChangesAsync_WhenDeletingASongPartAlone_ResolvesTheOrganizationThroughTheSong()
    {
        // Arrange
        await SeedSongAsync("song-1", withPartId: "part-1");

        // Act
        await using var context = await factory.CreateDbContextAsync();
        var part = await context.SongParts.SingleAsync(p => p.Id == "part-1");
        context.SongParts.Remove(part);
        await context.SaveChangesAsync();

        // Assert
        var tombstone = await context.SyncTombstones.SingleAsync();
        tombstone.EntityType.ShouldBe(nameof(DbSongPart));
        tombstone.EntityId.ShouldBe("part-1");
        tombstone.OrganizationId.ShouldBe(org.Id);
    }

    [Fact]
    public async Task SaveChangesAsync_WhenSongAndPartsDieInTheSameSave_TombstonesOnlyTheSong()
    {
        // Arrange
        await SeedSongAsync("song-1", withPartId: "part-1");

        // Act -- removing the song cascades to its parts in the change tracker
        await using var context = await factory.CreateDbContextAsync();
        var song = await context.Songs.Include(s => s.Parts).SingleAsync(s => s.Id == "song-1");
        context.Songs.Remove(song);
        await context.SaveChangesAsync();

        // Assert -- the song tombstone covers the parts; clients cascade locally
        var tombstone = await context.SyncTombstones.SingleAsync();
        tombstone.EntityType.ShouldBe(nameof(DbSong));
        tombstone.EntityId.ShouldBe("song-1");
    }

    [Fact]
    public async Task SaveChangesAsync_WhenDeletingAPresentationItemAlone_ResolvesTheOrganizationThroughThePresentation()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Presentations.Add(new Presentation { Id = "pres-1", Name = "Sunday", OrganizationId = org.Id });
            seed.PresentationItems.Add(new PresentationItem { Id = "item-1", Title = "Song", PresentationId = "pres-1" });
            await seed.SaveChangesAsync();
        }

        // Act
        await using var context = await factory.CreateDbContextAsync();
        var item = await context.PresentationItems.SingleAsync(i => i.Id == "item-1");
        context.PresentationItems.Remove(item);
        await context.SaveChangesAsync();

        // Assert
        var tombstone = await context.SyncTombstones.SingleAsync();
        tombstone.EntityType.ShouldBe(nameof(PresentationItem));
        tombstone.OrganizationId.ShouldBe(org.Id);
    }

    [Fact]
    public async Task SaveChanges_TheSynchronousOverload_AlsoStampsAndTombstones()
    {
        // Arrange
        using (var seed = factory.CreateDbContext())
        {
            seed.SongPartLabels.Add(new DbSongPartLabel { Id = "label-1", Text = "Vers", OrganizationId = org.Id });
            seed.SaveChanges();
        }

        // Act
        using var context = factory.CreateDbContext();
        var label = context.SongPartLabels.Single(l => l.Id == "label-1");
        context.SongPartLabels.Remove(label);
        context.SaveChanges();

        // Assert
        label.ModifiedAt.ShouldBeGreaterThan(Past);
        context.SyncTombstones.Single().EntityId.ShouldBe("label-1");
    }

    [Fact]
    public async Task AddTombstones_ForExecuteDeletePaths_WritesOneRowPerEntity()
    {
        // Act
        await using var context = await factory.CreateDbContextAsync();
        context.AddTombstones(nameof(Presentation), ["a", "b"], org.Id);
        await context.SaveChangesAsync();

        // Assert
        var tombstones = await context.SyncTombstones.OrderBy(t => t.EntityId).ToListAsync();
        tombstones.Count.ShouldBe(2);
        tombstones[0].EntityId.ShouldBe("a");
        tombstones[1].EntityId.ShouldBe("b");
        tombstones.ShouldAllBe(t => t.EntityType == nameof(Presentation) && t.OrganizationId == org.Id);
    }

    private async Task SeedSongAsync(string songId, string? withPartId = null)
    {
        await using var seed = await factory.CreateDbContextAsync();
        var song = new DbSong { Id = songId, Name = "Song", OrganizationId = org.Id };
        if (withPartId is not null)
            song.Parts.Add(new DbSongPart { Id = withPartId, Content = "Text", SortOrder = 0 });
        seed.Songs.Add(song);
        await seed.SaveChangesAsync();
    }

    private async Task BackdateAsync<T>(string id) where T : class, ISyncTracked
    {
        await using var context = await factory.CreateDbContextAsync();
        await context.Set<T>()
            .Where(e => EF.Property<string>(e, "Id") == id)
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.ModifiedAt, Past));
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
