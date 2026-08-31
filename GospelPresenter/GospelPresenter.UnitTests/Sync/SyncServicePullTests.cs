using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// Covers the pull half of the sync protocol: organisation isolation, incremental windows,
/// keyset paging across the fixed table order, tombstone delivery, and the full-resync answer
/// for clients older than the tombstone purge horizon.
/// </summary>
public class SyncServicePullTests : IDisposable
{
    private static readonly DateTimeOffset Past = DateTimeOffset.UtcNow.AddHours(-2);

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly SyncService service;
    private readonly Organization orgA;
    private readonly Organization orgB;
    private readonly CallerContext callerA;

    public SyncServicePullTests()
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

        orgA = new Organization { Name = "Org A" };
        orgB = new Organization { Name = "Org B" };
        context.Organizations.AddRange(orgA, orgB);
        context.Users.AddRange(
            new User { Id = "user-a", Name = "Anna", Email = "anna@example.com", OrganizationId = orgA.Id },
            new User { Id = "user-b", Name = "Bo", Email = "bo@example.com", OrganizationId = orgB.Id });

        var songA = new DbSong { Id = "song-a", Name = "Amazing Grace", OrganizationId = orgA.Id };
        songA.Parts.Add(new DbSongPart { Id = "part-a", Content = "Verse", SortOrder = 0 });
        songA.Arrangements.Add(new DbSongArrangement { Id = "arr-a", PartIdsJson = """["part-a"]""" });
        context.Songs.Add(songA);
        context.Songs.Add(new DbSong { Id = "song-b", Name = "Theirs", OrganizationId = orgB.Id });

        context.SongPartLabels.Add(new DbSongPartLabel { Id = "label-a", Text = "Vers", OrganizationId = orgA.Id });

        var presentation = new Presentation { Id = "pres-a", Name = "Sunday", OrganizationId = orgA.Id };
        context.Presentations.Add(presentation);
        context.PresentationItems.Add(new PresentationItem { Id = "item-a", Title = "Song", PresentationId = "pres-a" });
        context.PresentationItemParts.Add(new PresentationItemPart { Id = "ipart-a", Content = "Text", PresentationItemId = "item-a" });

        context.Themes.AddRange(
            new Theme { Id = "built-in", OrganizationId = null, Name = "" },
            new Theme { Id = "theme-a", OrganizationId = orgA.Id, Name = "Ours" },
            new Theme { Id = "theme-b", OrganizationId = orgB.Id, Name = "Theirs" });

        context.UserSettings.AddRange(
            new UserSetting { Id = "us-a", UserId = "user-a", Key = "k", Value = "v" },
            new UserSetting { Id = "us-b", UserId = "user-b", Key = "k", Value = "v" });
        context.OrganizationSettings.Add(new OrganizationSetting { Id = "os-a", OrganizationId = orgA.Id, Key = "k", Value = "v" });

        context.Bibles.Add(new DbBible { Id = "bible-a", Name = "Bibel 2000", Abbreviation = "B2000", VersesJson = "[]", OrganizationId = orgA.Id });

        context.SaveChanges();

        callerA = new CallerContext("user-a", UserRole.User, orgA.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task Pull_WithoutAWatermark_ReturnsEverythingInTheOrganization()
    {
        // Act
        var response = await service.PullAsync(orgA.Id, new SyncPullRequest(null, null), callerA);

        // Assert
        response.RequiresFullResync.ShouldBeFalse();
        response.HasMore.ShouldBeFalse();
        response.Changes.Songs.Select(s => s.Id).ShouldBe(["song-a"]);
        response.Changes.SongParts.Select(p => p.Id).ShouldBe(["part-a"]);
        response.Changes.SongArrangements.Select(a => a.Id).ShouldBe(["arr-a"]);
        response.Changes.SongPartLabels.Select(l => l.Id).ShouldBe(["label-a"]);
        response.Changes.Presentations.Select(p => p.Id).ShouldBe(["pres-a"]);
        response.Changes.PresentationItems.Select(i => i.Id).ShouldBe(["item-a"]);
        response.Changes.PresentationItemParts.Select(p => p.Id).ShouldBe(["ipart-a"]);
        response.Changes.Bibles.Select(b => b.Id).ShouldBe(["bible-a"]);
        response.Changes.OrganizationSettings.Select(s => s.Id).ShouldBe(["os-a"]);

        // Built-in themes reach every client; the other organisation's do not.
        response.Changes.Themes.Select(t => t.Id).OrderBy(x => x).ShouldBe(["built-in", "theme-a"]);

        // Only the caller's own settings.
        response.Changes.UserSettings.Select(s => s.Id).ShouldBe(["us-a"]);
    }

    [Fact]
    public async Task Pull_WithAWatermark_ReturnsOnlyRowsChangedAfterIt()
    {
        // Arrange -- age all rows well past the overlap window, then change one
        await BackdateEverythingAsync();
        await using (var context = await factory.CreateDbContextAsync())
        {
            var song = await context.Songs.SingleAsync(s => s.Id == "song-a");
            song.Name = "Renamed";
            await context.SaveChangesAsync();
        }

        // Act
        var response = await service.PullAsync(orgA.Id,
            new SyncPullRequest(DateTimeOffset.UtcNow.AddMinutes(-30), null), callerA);

        // Assert
        response.Changes.Songs.Select(s => s.Name).ShouldBe(["Renamed"]);
        response.Changes.SongParts.ShouldBeEmpty();
        response.Changes.Presentations.ShouldBeEmpty();
        response.Changes.Themes.ShouldBeEmpty();
        response.Tombstones.ShouldBeEmpty();
    }

    [Fact]
    public async Task Pull_WithASmallPageSize_WalksAllTablesWithoutLossOrDuplicates()
    {
        // Act -- page through everything three rows at a time
        var ids = new List<string>();
        string? cursor = null;
        SyncPullResponse response;
        var pages = 0;
        do
        {
            response = await service.PullAsync(orgA.Id, new SyncPullRequest(null, cursor, Take: 3), callerA);
            ids.AddRange(AllRowIds(response.Changes));
            cursor = response.NextCursor;
            pages++;
            pages.ShouldBeLessThan(30, "paging must terminate");
        } while (response.HasMore);

        // Assert -- same rows as one unpaged pull, each exactly once
        var full = await service.PullAsync(orgA.Id, new SyncPullRequest(null, null), callerA);
        ids.OrderBy(x => x).ShouldBe(AllRowIds(full.Changes).OrderBy(x => x));
        ids.Count.ShouldBe(ids.Distinct().Count());
    }

    [Fact]
    public async Task Pull_AfterADeletion_DeliversTheTombstoneButNotOtherOrganizations()
    {
        // Arrange
        await BackdateEverythingAsync();
        await using (var context = await factory.CreateDbContextAsync())
        {
            var label = await context.SongPartLabels.SingleAsync(l => l.Id == "label-a");
            context.SongPartLabels.Remove(label);
            context.AddTombstones(nameof(DbSong), ["their-song"], orgB.Id);
            await context.SaveChangesAsync();
        }

        // Act
        var response = await service.PullAsync(orgA.Id,
            new SyncPullRequest(DateTimeOffset.UtcNow.AddMinutes(-30), null), callerA);

        // Assert
        var tombstone = response.Tombstones.ShouldHaveSingleItem();
        tombstone.EntityType.ShouldBe(nameof(DbSongPartLabel));
        tombstone.EntityId.ShouldBe("label-a");
    }

    [Fact]
    public async Task Pull_WithAWatermarkOlderThanTheTombstoneHorizon_RequiresFullResync()
    {
        // Act
        var response = await service.PullAsync(orgA.Id,
            new SyncPullRequest(DateTimeOffset.UtcNow.AddDays(-100), null), callerA);

        // Assert
        response.RequiresFullResync.ShouldBeTrue();
        AllRowIds(response.Changes).ShouldBeEmpty();
        response.Tombstones.ShouldBeEmpty();
    }

    [Fact]
    public async Task Pull_ForAnotherOrganization_Throws()
    {
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.PullAsync(orgB.Id, new SyncPullRequest(null, null), callerA));
    }

    [Fact]
    public async Task Pull_WithAGarbageCursor_Throws()
    {
        await Should.ThrowAsync<ArgumentException>(
            () => service.PullAsync(orgA.Id, new SyncPullRequest(null, "not-a-cursor"), callerA));
    }

    [Fact]
    public async Task Pull_TheAdvertisedWatermark_PicksUpWritesCommittedJustBeforeIt()
    {
        // Arrange -- a completed sync, then a change
        await BackdateEverythingAsync();
        var first = await service.PullAsync(orgA.Id,
            new SyncPullRequest(DateTimeOffset.UtcNow.AddMinutes(-30), null), callerA);
        await using (var context = await factory.CreateDbContextAsync())
        {
            var song = await context.Songs.SingleAsync(s => s.Id == "song-a");
            song.Name = "Changed after first pull";
            await context.SaveChangesAsync();
        }

        // Act -- next pull resumes from the advertised watermark
        var second = await service.PullAsync(orgA.Id,
            new SyncPullRequest(first.ServerWatermark, null), callerA);

        // Assert
        second.Changes.Songs.Select(s => s.Name).ShouldContain("Changed after first pull");
    }

    private async Task BackdateEverythingAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        await context.Songs.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.SongParts.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.SongArrangements.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.SongPartLabels.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.Presentations.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.PresentationItems.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.PresentationItemParts.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.Themes.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.UserSettings.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.OrganizationSettings.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        await context.Bibles.ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
    }

    private static List<string> AllRowIds(SyncChanges changes) =>
    [
        .. changes.SongPartLabels.Select(x => x.Id),
        .. changes.Songs.Select(x => x.Id),
        .. changes.SongParts.Select(x => x.Id),
        .. changes.SongArrangements.Select(x => x.Id),
        .. changes.SongVersions.Select(x => x.Id),
        .. changes.Presentations.Select(x => x.Id),
        .. changes.PresentationItems.Select(x => x.Id),
        .. changes.PresentationItemParts.Select(x => x.Id),
        .. changes.PresentationSlides.Select(x => x.Id),
        .. changes.Themes.Select(x => x.Id),
        .. changes.OverlaySlides.Select(x => x.Id),
        .. changes.OrganizationImages.Select(x => x.Id),
        .. changes.OrganizationAudios.Select(x => x.Id),
        .. changes.OrganizationSettings.Select(x => x.Id),
        .. changes.UserSettings.Select(x => x.Id),
        .. changes.Bibles.Select(x => x.Id),
    ];

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
