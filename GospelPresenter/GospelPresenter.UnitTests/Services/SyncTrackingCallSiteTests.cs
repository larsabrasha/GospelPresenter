using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Pins every service mutation path that bypasses the change tracker (ExecuteUpdate/ExecuteDelete)
/// or that must move an aggregate root's ModifiedAt when a child changes. Sync correctness depends
/// on each of these call sites: a path that forgets to stamp ModifiedAt makes the change invisible
/// to pulling clients, and a delete without a tombstone can never be propagated at all.
/// </summary>
public class SyncTrackingCallSiteTests : IDisposable
{
    private static readonly DateTimeOffset Past = DateTimeOffset.UtcNow.AddHours(-1);

    private const string PresentationId = "pres-1";
    private const string TemplateId = "template-1";
    private const string ItemId = "item-1";
    private const string PartId = "part-1";
    private const string SongId = "song-1";
    private const string SongPartId = "song-part-1";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly PresentationService presentationService;
    private readonly SongService songService;
    private readonly Organization org;
    private readonly CallerContext caller;

    public SyncTrackingCallSiteTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        presentationService = new PresentationService(factory, new NoOpObjectStorageService());
        songService = new SongService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = "Org" };
        context.Organizations.Add(org);

        context.Presentations.AddRange(
            new Presentation { Id = PresentationId, Name = "Sunday", OrganizationId = org.Id },
            new Presentation { Id = TemplateId, Name = "Weekly", OrganizationId = org.Id, IsTemplate = true });
        context.PresentationItems.Add(new PresentationItem { Id = ItemId, Title = "Song", PresentationId = PresentationId });
        context.PresentationItemParts.Add(new PresentationItemPart { Id = PartId, Content = "Text", PresentationItemId = ItemId });

        var song = new DbSong { Id = SongId, Name = "Amazing Grace", OrganizationId = org.Id };
        song.Parts.Add(new DbSongPart { Id = SongPartId, Content = "Verse text", SortOrder = 0 });
        context.Songs.Add(song);

        context.SaveChanges();

        caller = new CallerContext("user-1", UserRole.Admin, org.Id);

        // Every test asserts that ModifiedAt moved; starting from the past makes that observable.
        BackdateAll(context);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    // --- PresentationService: ExecuteUpdate paths and aggregate bumps ---

    [Fact]
    public async Task AddItemAsync_BumpsThePresentation()
    {
        await presentationService.AddItemAsync(org.Id, PresentationId, new PresentationItem { Title = "New" }, caller);

        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task RenamePresentationAsync_BumpsThePresentation()
    {
        await presentationService.RenamePresentationAsync(org.Id, PresentationId, "Renamed", caller);

        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task ReorderItemsAsync_BumpsThePresentation()
    {
        await presentationService.ReorderItemsAsync(org.Id, PresentationId, [ItemId], caller);

        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task RenameItemAsync_BumpsTheItemAndThePresentation()
    {
        await presentationService.RenameItemAsync(org.Id, PresentationId, ItemId, "New title", caller);

        await using var context = await factory.CreateDbContextAsync();
        (await context.PresentationItems.SingleAsync(i => i.Id == ItemId)).ModifiedAt.ShouldBeGreaterThan(Past);
        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task UpdateItemArrangementAsync_BumpsTheItemAndThePresentation()
    {
        await presentationService.UpdateItemArrangementAsync(org.Id, PresentationId, ItemId, "arr-1", caller);

        await using var context = await factory.CreateDbContextAsync();
        (await context.PresentationItems.SingleAsync(i => i.Id == ItemId)).ModifiedAt.ShouldBeGreaterThan(Past);
        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task AddItemPartsAsync_BumpsThePresentation()
    {
        await presentationService.AddItemPartsAsync(org.Id, PresentationId, ItemId,
            [new PresentationItemPart { Content = "More" }], caller);

        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task RemoveItemPartAsync_TombstonesThePartAndBumpsThePresentation()
    {
        await presentationService.RemoveItemPartAsync(org.Id, PresentationId, ItemId, PartId, caller);

        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(PresentationItemPart));
        tombstone.EntityId.ShouldBe(PartId);
        tombstone.OrganizationId.ShouldBe(org.Id);
        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task ReorderItemPartsAsync_BumpsThePresentation()
    {
        await presentationService.ReorderItemPartsAsync(org.Id, PresentationId, ItemId, [PartId], caller);

        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task RemoveItemAsync_TombstonesTheItemAndBumpsThePresentation()
    {
        await presentationService.RemoveItemAsync(org.Id, PresentationId, ItemId, caller);

        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(PresentationItem));
        tombstone.EntityId.ShouldBe(ItemId);
        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task RemoveItemAsync_ForASlidesItem_AlsoTombstonesTheSlides()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.PresentationSlides.Add(new PresentationSlides { Id = "slides-1", FileName = "deck.pptx", PresentationId = PresentationId });
            seed.PresentationItems.Add(new PresentationItem
            {
                Id = "slides-item", Title = "Deck", PresentationId = PresentationId,
                Type = PresentationItemType.Slides, SourceId = "slides-1"
            });
            await seed.SaveChangesAsync();
        }

        // Act
        await presentationService.RemoveItemAsync(org.Id, PresentationId, "slides-item", caller);

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        var tombstones = await context.SyncTombstones.OrderBy(t => t.EntityType).ToListAsync();
        tombstones.Select(t => (t.EntityType, t.EntityId)).ShouldBe([
            (nameof(PresentationItem), "slides-item"),
            (nameof(PresentationSlides), "slides-1")
        ]);
    }

    [Fact]
    public async Task RemoveItemsAsync_TombstonesEachItem()
    {
        await presentationService.RemoveItemsAsync(org.Id, PresentationId, [ItemId, "no-such-item"], caller);

        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(PresentationItem));
        tombstone.EntityId.ShouldBe(ItemId);
        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task DeletePresentationAsync_TombstonesOnlyTheAggregateRoot()
    {
        await presentationService.DeletePresentationAsync(org.Id, PresentationId, caller);

        // The presentation tombstone covers items, parts and slides; clients cascade locally.
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(Presentation));
        tombstone.EntityId.ShouldBe(PresentationId);
    }

    [Fact]
    public async Task DeleteTemplateAsync_TombstonesTheTemplate()
    {
        await presentationService.DeleteTemplateAsync(org.Id, TemplateId, caller);

        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(Presentation));
        tombstone.EntityId.ShouldBe(TemplateId);
    }

    [Fact]
    public async Task UpdateTemplateScheduleAsync_BumpsTheTemplate()
    {
        await presentationService.UpdateTemplateScheduleAsync(org.Id, TemplateId, 0, new TimeOnly(10, 0), null, caller);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.SingleAsync(p => p.Id == TemplateId)).ModifiedAt.ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task UpdatePresentationEventAsync_BumpsThePresentation()
    {
        await presentationService.UpdatePresentationEventAsync(org.Id, PresentationId, new DateOnly(2026, 9, 6), null, null, null, caller);

        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task UpdatePresentationThemeAsync_BumpsThePresentation()
    {
        // Arrange -- the theme must exist and be usable by the organisation
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Themes.Add(new Theme { Id = "theme-1", OrganizationId = org.Id, Name = "Ours" });
            await seed.SaveChangesAsync();
        }

        // Act
        await presentationService.UpdatePresentationThemeAsync(org.Id, PresentationId, "theme-1", caller);

        // Assert
        (await GetPresentationModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task RemoveOverlayAsync_TombstonesTheOverlay()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.OverlaySlides.Add(new OverlaySlide { Id = "overlay-1", Title = "Info", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }

        // Act
        await presentationService.RemoveOverlayAsync(org.Id, "overlay-1", caller);

        // Assert
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(OverlaySlide));
        tombstone.EntityId.ShouldBe("overlay-1");
    }

    // --- SongService: the song row is the aggregate version for parts and arrangements ---

    [Fact]
    public async Task UpdateSongPartAsync_BumpsTheSong()
    {
        await songService.UpdateSongPartAsync(SongId, org.Id, 0, null, "New text", caller);

        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task UpdateSongPartsAsync_BumpsTheSong()
    {
        await songService.UpdateSongPartsAsync(SongId, org.Id,
            new Dictionary<int, (string?, string)> { [0] = (null, "New text") }, caller);

        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task AddSongPartAsync_BumpsTheSong()
    {
        await songService.AddSongPartAsync(SongId, org.Id, null, "Second verse", caller);

        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task DeleteSongPartAsync_TombstonesThePartAndBumpsTheSong()
    {
        await songService.DeleteSongPartAsync(SongId, org.Id, 0, caller);

        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(DbSongPart));
        tombstone.EntityId.ShouldBe(SongPartId);
        tombstone.OrganizationId.ShouldBe(org.Id);
        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task MoveSongPartAsync_BumpsTheSong()
    {
        // Arrange -- moving needs two parts
        await songService.AddSongPartAsync(SongId, org.Id, null, "Second verse", caller);
        await using (var context = await factory.CreateDbContextAsync())
        {
            await context.Songs.Where(s => s.Id == SongId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        }

        // Act
        await songService.MoveSongPartAsync(SongId, org.Id, 0, 1, caller);

        // Assert
        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task CreateSongArrangementAsync_BumpsTheSong()
    {
        await songService.CreateSongArrangementAsync(SongId, org.Id, "Live", [SongPartId], caller);

        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task DeleteSongArrangementAsync_TombstonesTheArrangementAndBumpsTheSong()
    {
        // Arrange
        await songService.CreateSongArrangementAsync(SongId, org.Id, "Live", [SongPartId], caller);
        string arrangementId;
        await using (var context = await factory.CreateDbContextAsync())
        {
            arrangementId = (await context.SongArrangements.SingleAsync()).Id;
            await context.Songs.Where(s => s.Id == SongId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ModifiedAt, Past));
        }

        // Act
        await songService.DeleteSongArrangementAsync(SongId, org.Id, arrangementId, caller);

        // Assert
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(DbSongArrangement));
        tombstone.EntityId.ShouldBe(arrangementId);
        (await GetSongModifiedAtAsync()).ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task DeleteSongAsync_SoftDeletes_NoTombstoneButBumpsTheSong()
    {
        await songService.DeleteSongAsync(SongId, org.Id, caller);

        // Soft delete syncs as an ordinary row update carrying DeletedAt.
        await using var context = await factory.CreateDbContextAsync();
        (await context.SyncTombstones.AnyAsync()).ShouldBeFalse();
        var song = await context.Songs.SingleAsync(s => s.Id == SongId);
        song.DeletedAt.ShouldNotBeNull();
        song.ModifiedAt.ShouldBeGreaterThan(Past);
    }

    [Fact]
    public async Task PermanentlyDeleteSongAsync_TombstonesOnlyTheSong()
    {
        // Arrange -- only trashed songs can be permanently deleted
        await songService.DeleteSongAsync(SongId, org.Id, caller);

        // Act
        await songService.PermanentlyDeleteSongAsync(SongId, org.Id, caller);

        // Assert -- the song tombstone covers parts and arrangements via client-side cascade
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(DbSong));
        tombstone.EntityId.ShouldBe(SongId);
    }

    // --- Media, settings and bibles ---

    [Fact]
    public async Task DeleteImageAsync_TombstonesTheImage()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.OrganizationImages.Add(new OrganizationImage { Id = "image-1", FileName = "a.jpg", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }
        var service = new OrganizationImageService(factory, new NoOpObjectStorageService());

        // Act
        await service.DeleteImageAsync("image-1", org.Id, caller);

        // Assert
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(OrganizationImage));
        tombstone.EntityId.ShouldBe("image-1");
    }

    [Fact]
    public async Task DeleteAudioAsync_TombstonesTheAudio()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.OrganizationAudios.Add(new OrganizationAudio { Id = "audio-1", FileName = "a.mp3", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }
        var service = new OrganizationAudioService(factory, new NoOpObjectStorageService());

        // Act
        await service.DeleteAudioAsync("audio-1", org.Id, caller);

        // Assert
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(OrganizationAudio));
        tombstone.EntityId.ShouldBe("audio-1");
    }

    [Fact]
    public async Task DeleteUserSettingAsync_TombstonesTheSettingWithTheUser()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Users.Add(new User { Id = "user-1", Name = "Anna", Email = "anna@example.com", OrganizationId = org.Id });
            seed.UserSettings.Add(new UserSetting { Id = "setting-1", UserId = "user-1", Key = "k", Value = "v" });
            await seed.SaveChangesAsync();
        }
        var service = new UserService(factory, new SongPartLabelService(factory));

        // Act
        await service.DeleteUserSettingAsync("user-1", "k", new CallerContext("user-1", UserRole.User, org.Id));

        // Assert
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(UserSetting));
        tombstone.EntityId.ShouldBe("setting-1");
        tombstone.UserId.ShouldBe("user-1");
    }

    [Fact]
    public async Task DeleteBibleAsync_TombstonesTheBible()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Bibles.Add(new DbBible { Id = "bible-1", Name = "Bibel 2000", Abbreviation = "B2000", OrganizationId = org.Id });
            await seed.SaveChangesAsync();
        }
        var service = new BibleService(factory, NullLogger<BibleService>.Instance);

        // Act
        await service.DeleteBibleAsync("B2000", org.Id, caller);

        // Assert
        var tombstone = await GetSingleTombstoneAsync();
        tombstone.EntityType.ShouldBe(nameof(DbBible));
        tombstone.EntityId.ShouldBe("bible-1");
    }

    // --- Helpers ---

    private void BackdateAll(PresentationContext context)
    {
        context.Presentations.ExecuteUpdate(s => s.SetProperty(p => p.ModifiedAt, Past));
        context.PresentationItems.ExecuteUpdate(s => s.SetProperty(i => i.ModifiedAt, Past));
        context.PresentationItemParts.ExecuteUpdate(s => s.SetProperty(p => p.ModifiedAt, Past));
        context.Songs.ExecuteUpdate(s => s.SetProperty(x => x.ModifiedAt, Past));
        context.SongParts.ExecuteUpdate(s => s.SetProperty(p => p.ModifiedAt, Past));
    }

    private async Task<DateTimeOffset> GetPresentationModifiedAtAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        return (await context.Presentations.SingleAsync(p => p.Id == PresentationId)).ModifiedAt;
    }

    private async Task<DateTimeOffset> GetSongModifiedAtAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        return (await context.Songs.SingleAsync(s => s.Id == SongId)).ModifiedAt;
    }

    private async Task<SyncTombstone> GetSingleTombstoneAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        return await context.SyncTombstones.SingleAsync();
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    // Delete paths clean up object storage after the database transaction; storage behaviour is
    // out of scope here, so every operation is a no-op.
    private class NoOpObjectStorageService : IObjectStorageService
    {
        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult<(Stream, string)?>(null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
