using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The one trash, gathered from the five that hold the rows.
///
/// Three things are worth pinning here. That every kind actually turns up — a kind left out of
/// TrashService.GetAsync is invisible to the only page that shows the trash, and the thing the user
/// deleted is then simply gone as far as they can tell. That the list and its buttons agree: what
/// is shown must be restorable by whoever is looking, which is why the gathering is gated on the
/// Manage permissions and not the View ones. And that merely reading the trash survives an object
/// store that is down, because the retention sweep rides along on that read.
/// </summary>
public class TrashServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly TrashService trash;
    private readonly PresentationService presentations;
    private readonly SongService songs;
    private readonly OrganizationImageService images;
    private readonly OrganizationAudioService audios;
    private readonly Organization org;
    private readonly CallerContext admin;

    private const string PresentationId = "pres-1";
    private const string TemplateId = "template-1";
    private const string SongId = "song-1";

    public TrashServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);

        var storage = new NoOpObjectStorageService();
        presentations = new PresentationService(factory, storage);
        songs = new SongService(factory);
        images = new OrganizationImageService(factory, storage);
        audios = new OrganizationAudioService(factory, storage);
        trash = new TrashService(presentations, songs, images, audios);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = "Org" };
        context.Organizations.Add(org);
        context.SaveChanges();

        context.Presentations.AddRange(
            new Presentation { Id = PresentationId, Name = "Söndagsgudstjänst", OrganizationId = org.Id, EventDate = new DateOnly(2026, 9, 6) },
            new Presentation
            {
                Id = TemplateId, Name = "Veckomall", OrganizationId = org.Id, IsTemplate = true,
                ScheduledDayOfWeek = 0, ScheduledTime = new TimeOnly(11, 0)
            });
        context.Songs.Add(new DbSong { Id = SongId, Name = "Amazing Grace", Author = "John Newton", OrganizationId = org.Id });
        context.SaveChanges();

        admin = new CallerContext("user-1", UserRole.Admin, org.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Get_ReturnsNothingWhenNothingHasBeenDeleted()
    {
        (await trash.GetAsync(org.Id, admin)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Get_GathersEveryKind()
    {
        var imageId = await TrashAnImageAsync();
        var audioId = await TrashAnAudioAsync();
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);
        await presentations.DeleteTemplateAsync(org.Id, TemplateId, admin);
        await songs.DeleteSongAsync(SongId, org.Id, admin);

        var entries = await trash.GetAsync(org.Id, admin);

        entries.Select(e => e.Kind).ShouldBe(
            [TrashKind.Presentation, TrashKind.Template, TrashKind.Song, TrashKind.Image, TrashKind.Audio],
            ignoreOrder: true);
        entries.ShouldContain(e => e.Kind == TrashKind.Image && e.Id == imageId);
        entries.ShouldContain(e => e.Kind == TrashKind.Audio && e.Id == audioId);
    }

    [Fact]
    public async Task Get_PutsTheMostRecentlyDeletedFirst()
    {
        // What someone just deleted by mistake has to be the first thing they see.
        await songs.DeleteSongAsync(SongId, org.Id, admin);
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);

        var entries = await trash.GetAsync(org.Id, admin);

        entries[0].Kind.ShouldBe(TrashKind.Presentation);
    }

    [Fact]
    public async Task Get_CarriesWhatTellsTwoOfAKindApart()
    {
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);
        await presentations.DeleteTemplateAsync(org.Id, TemplateId, admin);
        await songs.DeleteSongAsync(SongId, org.Id, admin);

        var entries = await trash.GetAsync(org.Id, admin);

        entries.Single(e => e.Kind == TrashKind.Presentation).EventDate.ShouldBe(new DateOnly(2026, 9, 6));
        entries.Single(e => e.Kind == TrashKind.Template).ScheduledDayOfWeek.ShouldBe(0);
        entries.Single(e => e.Kind == TrashKind.Template).ScheduledTime.ShouldBe(new TimeOnly(11, 0));
        entries.Single(e => e.Kind == TrashKind.Song).Author.ShouldBe("John Newton");
    }

    [Fact]
    public async Task Get_ShowsOnlyWhatTheCallerCanActuallyRestore()
    {
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);
        await presentations.DeleteTemplateAsync(org.Id, TemplateId, admin);
        await songs.DeleteSongAsync(SongId, org.Id, admin);

        // An ordinary user may view templates but not manage them. Listing a template here would
        // put a Restore and a Delete-permanently button next to a row where both can only throw,
        // and would make "Empty trash" count a row it then silently steps over.
        var user = new CallerContext("user-2", UserRole.User, org.Id);
        var entries = await trash.GetAsync(org.Id, user);

        entries.ShouldNotContain(e => e.Kind == TrashKind.Template);
        entries.ShouldContain(e => e.Kind == TrashKind.Presentation);
        entries.ShouldContain(e => e.Kind == TrashKind.Song);
    }

    [Fact]
    public async Task Get_ListsOnlyRowsWhoseButtonsWork()
    {
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);
        await presentations.DeleteTemplateAsync(org.Id, TemplateId, admin);
        await songs.DeleteSongAsync(SongId, org.Id, admin);
        var user = new CallerContext("user-2", UserRole.User, org.Id);

        // Whatever the list shows, restoring it must work. This is the invariant the permission
        // gate exists for; if the gate ever drifts back to the View permissions, this fails.
        foreach (var entry in await trash.GetAsync(org.Id, user))
            await Should.NotThrowAsync(() => trash.RestoreAsync(entry.Kind, entry.Id, org.Id, user));
    }

    [Fact]
    public async Task Get_StillWorksWhenObjectStorageIsDownAndSomethingHasExpired()
    {
        // Retention is swept on the read path. If that sweep were allowed to fail the read, one
        // expired row plus an unreachable S3 would lock everyone out of the whole trash — including
        // the rows that have no files at all — for as long as storage stayed down.
        var brokenStorage = new ThrowingObjectStorageService();
        var brokenImages = new OrganizationImageService(factory, brokenStorage);
        var brokenTrash = new TrashService(
            new PresentationService(factory, brokenStorage), songs, brokenImages,
            new OrganizationAudioService(factory, brokenStorage));

        var image = await brokenImages.AddImageAsync(org.Id, "old.jpg", "image/jpeg", [1], [1], admin);
        await brokenImages.DeleteImageAsync(image.Id, org.Id, admin);
        await BackdateImageAsync(image.Id, AppConstraints.TrashRetentionDays + 1);
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);

        // The assertion is simply that this returns at all. What the failed purge leaves behind —
        // here the row is gone because the database commits before storage is touched, so only the
        // bytes are orphaned — matters far less than the trash staying openable.
        var entries = await brokenTrash.GetAsync(org.Id, admin);

        entries.ShouldContain(e => e.Kind == TrashKind.Presentation,
            "the rows that need no storage at all must still be reachable");
    }

    [Fact]
    public async Task Get_RefusesAnotherOrganisation()
    {
        var outsider = new CallerContext("user-3", UserRole.Admin, "another-org");

        await Should.ThrowAsync<UnauthorizedAccessException>(() => trash.GetAsync(org.Id, outsider));
    }

    [Theory]
    [InlineData(TrashKind.Presentation)]
    [InlineData(TrashKind.Template)]
    [InlineData(TrashKind.Song)]
    public async Task Restore_RoutesToTheRightService(TrashKind kind)
    {
        var id = kind switch
        {
            TrashKind.Presentation => PresentationId,
            TrashKind.Template => TemplateId,
            _ => SongId
        };
        await DeleteAsync(kind, id);
        (await trash.GetAsync(org.Id, admin)).ShouldHaveSingleItem();

        await trash.RestoreAsync(kind, id, org.Id, admin);

        (await trash.GetAsync(org.Id, admin)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Restore_RoutesMediaToTheRightService()
    {
        var imageId = await TrashAnImageAsync();
        var audioId = await TrashAnAudioAsync();

        await trash.RestoreAsync(TrashKind.Image, imageId, org.Id, admin);
        await trash.RestoreAsync(TrashKind.Audio, audioId, org.Id, admin);

        (await trash.GetAsync(org.Id, admin)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Purge_RemovesOnlyTheOneAskedFor()
    {
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);
        await songs.DeleteSongAsync(SongId, org.Id, admin);

        await trash.PurgeAsync(TrashKind.Song, SongId, org.Id, admin);

        var entries = await trash.GetAsync(org.Id, admin);
        entries.ShouldHaveSingleItem().Kind.ShouldBe(TrashKind.Presentation);
    }

    [Fact]
    public async Task Empty_ClearsEveryKindAtOnce()
    {
        await TrashAnImageAsync();
        await TrashAnAudioAsync();
        await presentations.DeletePresentationAsync(org.Id, PresentationId, admin);
        await presentations.DeleteTemplateAsync(org.Id, TemplateId, admin);
        await songs.DeleteSongAsync(SongId, org.Id, admin);

        await trash.EmptyAsync(org.Id, admin);

        (await trash.GetAsync(org.Id, admin)).ShouldBeEmpty();

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync()).ShouldBeFalse();
        (await context.Songs.AnyAsync()).ShouldBeFalse();
        (await context.OrganizationImages.AnyAsync()).ShouldBeFalse();
        (await context.OrganizationAudios.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task Empty_RefusesAnotherOrganisation()
    {
        var outsider = new CallerContext("user-3", UserRole.Admin, "another-org");

        await Should.ThrowAsync<UnauthorizedAccessException>(() => trash.EmptyAsync(org.Id, outsider));
    }

    private Task DeleteAsync(TrashKind kind, string id) => kind switch
    {
        TrashKind.Presentation => presentations.DeletePresentationAsync(org.Id, id, admin),
        TrashKind.Template => presentations.DeleteTemplateAsync(org.Id, id, admin),
        TrashKind.Song => songs.DeleteSongAsync(id, org.Id, admin),
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };

    private async Task BackdateImageAsync(string id, int days)
    {
        await using var context = await factory.CreateDbContextAsync();
        await context.OrganizationImages.Where(i => i.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.DeletedAt, DateTimeOffset.UtcNow.AddDays(-days)));
    }

    private async Task<string> TrashAnImageAsync()
    {
        var image = await images.AddImageAsync(org.Id, "bakgrund.jpg", "image/jpeg", [1], [1], admin);
        await images.DeleteImageAsync(image.Id, org.Id, admin);
        return image.Id;
    }

    private async Task<string> TrashAnAudioAsync()
    {
        var audio = await audios.AddAudioAsync(org.Id, "forspel.mp3", "audio/mpeg", [1], admin);
        await audios.DeleteAudioAsync(audio.Id, org.Id, admin);
        return audio.Id;
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    /// <summary>An object store that is down.</summary>
    private class ThrowingObjectStorageService : IObjectStorageService
    {
        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult<(Stream, string)?>(null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("object storage is unreachable");

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("object storage is unreachable");

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    /// <summary>Storage is beside the point here; the trash is a database question.</summary>
    private class NoOpObjectStorageService : IObjectStorageService
    {
        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult<(Stream, string)?>(null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
