using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The image and audio trash. The two services are separate but identical in shape, so the tests
/// run once against each through <see cref="IMediaTrashSubject"/>.
///
/// The assertion that matters most here is the one that does not exist for presentations: a trashed
/// file keeps being served. A presentation may already use it, and taking the bytes away — or
/// refusing to look the row up — would break that presentation mid-service. Trashing hides a file
/// from the library, nothing more, until the purge.
/// </summary>
public class MediaTrashTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly RecordingObjectStorageService storage = new();
    private readonly Organization orgA;
    private readonly Organization orgB;
    private readonly CallerContext callerA;
    private readonly CallerContext callerB;

    public MediaTrashTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        orgA = new Organization { Name = "Org A" };
        orgB = new Organization { Name = "Org B" };
        context.Organizations.AddRange(orgA, orgB);
        context.SaveChanges();

        callerA = new CallerContext("user-a", UserRole.Admin, orgA.Id);
        callerB = new CallerContext("user-b", UserRole.Admin, orgB.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
        GC.SuppressFinalize(this);
    }

    public static TheoryData<string> Kinds => ["image", "audio"];

    [Theory, MemberData(nameof(Kinds))]
    public async Task Delete_KeepsTheRowAndTheBytes(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);

        await subject.DeleteAsync(id, orgA.Id, callerA);

        (await subject.DeletedAtAsync(id)).ShouldNotBeNull();
        storage.DeletedPrefixes.ShouldBeEmpty("the bytes have to survive a restore");
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task Delete_HidesItFromTheLibrary(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);

        await subject.DeleteAsync(id, orgA.Id, callerA);

        (await subject.ListAsync(orgA.Id, callerA)).ShouldBeEmpty();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task Delete_LeavesTheFileServable(string kind)
    {
        // The reason the media endpoint's lookup is deliberately unfiltered: a presentation that
        // already uses this file must keep working while it sits in the trash.
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);

        await subject.DeleteAsync(id, orgA.Id, callerA);

        (await subject.GetByIdAsync(id, orgA.Id, callerA)).ShouldNotBeNull();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task Trash_ListsWhatWasDeleted(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "psalm.file", callerA);

        await subject.DeleteAsync(id, orgA.Id, callerA);

        var trashed = (await subject.TrashAsync(orgA.Id, callerA)).ShouldHaveSingleItem();
        trashed.Id.ShouldBe(id);
        trashed.FileName.ShouldBe("psalm.file");
        trashed.DaysRemaining.ShouldBe(AppConstraints.TrashRetentionDays);
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task Trash_DoesNotReachAnotherOrganisation(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgB.Id, "a.file", callerB);
        await subject.DeleteAsync(id, orgB.Id, callerB);

        (await subject.TrashAsync(orgA.Id, callerA)).ShouldBeEmpty();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task Restore_BringsItBackIntoTheLibrary(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);
        await subject.DeleteAsync(id, orgA.Id, callerA);

        await subject.RestoreAsync(id, orgA.Id, callerA);

        (await subject.TrashAsync(orgA.Id, callerA)).ShouldBeEmpty();
        (await subject.ListAsync(orgA.Id, callerA)).ShouldHaveSingleItem();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task PermanentDelete_RemovesTheRowAndTheBytes(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);
        await subject.DeleteAsync(id, orgA.Id, callerA);

        await subject.PermanentlyDeleteAsync(id, orgA.Id, callerA);

        (await subject.ExistsAsync(id)).ShouldBeFalse();
        storage.DeletedPrefixes.ShouldHaveSingleItem();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task PermanentDelete_OfSomethingNotInTheTrashDoesNothing(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);

        await subject.PermanentlyDeleteAsync(id, orgA.Id, callerA);

        // The purge reads from the trash only, so a live file cannot be destroyed by handing the
        // purge path its id.
        (await subject.ExistsAsync(id)).ShouldBeTrue();
        storage.DeletedPrefixes.ShouldBeEmpty();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task EmptyTrash_LeavesAnotherOrganisationsTrashAlone(string kind)
    {
        var subject = Subject(kind);
        var mine = await subject.AddAsync(orgA.Id, "mine.file", callerA);
        var theirs = await subject.AddAsync(orgB.Id, "theirs.file", callerB);
        await subject.DeleteAsync(mine, orgA.Id, callerA);
        await subject.DeleteAsync(theirs, orgB.Id, callerB);

        await subject.EmptyTrashAsync(orgA.Id, callerA);

        (await subject.ExistsAsync(mine)).ShouldBeFalse();
        (await subject.ExistsAsync(theirs)).ShouldBeTrue();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task Purge_TakesWhatIsPastTheRetentionWindowAndLeavesTheRest(string kind)
    {
        var subject = Subject(kind);
        var old = await subject.AddAsync(orgA.Id, "old.file", callerA);
        var recent = await subject.AddAsync(orgA.Id, "recent.file", callerA);
        await subject.DeleteAsync(old, orgA.Id, callerA);
        await subject.DeleteAsync(recent, orgA.Id, callerA);
        await subject.BackdateAsync(old, AppConstraints.TrashRetentionDays + 1);

        // The sweep is driven by TrashService on the read path rather than by the listing itself,
        // so that a purge failing on object storage cannot stop anyone opening the trash.
        await subject.PurgeExpiredAsync(orgA.Id, callerA);

        (await subject.TrashAsync(orgA.Id, callerA)).ShouldHaveSingleItem().Id.ShouldBe(recent);
        (await subject.ExistsAsync(old)).ShouldBeFalse();
    }

    [Theory, MemberData(nameof(Kinds))]
    public async Task TrashedFiles_DoNotCountAgainstTheQuota(string kind)
    {
        var subject = Subject(kind);
        var id = await subject.AddAsync(orgA.Id, "a.file", callerA);

        await subject.DeleteAsync(id, orgA.Id, callerA);

        (await subject.LiveCountAsync(orgA.Id)).ShouldBe(0);
    }

    private IMediaTrashSubject Subject(string kind) => kind switch
    {
        "image" => new ImageSubject(new OrganizationImageService(factory, storage), factory),
        "audio" => new AudioSubject(new OrganizationAudioService(factory, storage), factory),
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };

    /// <summary>
    /// What the two media services have in common, so one set of tests covers both. Written by hand
    /// rather than generically because the services share no interface — and giving them one purely
    /// for the tests would be the tail wagging the dog.
    /// </summary>
    private interface IMediaTrashSubject
    {
        Task<string> AddAsync(string organizationId, string fileName, CallerContext caller);
        Task DeleteAsync(string id, string organizationId, CallerContext caller);
        Task RestoreAsync(string id, string organizationId, CallerContext caller);
        Task PermanentlyDeleteAsync(string id, string organizationId, CallerContext caller);
        Task EmptyTrashAsync(string organizationId, CallerContext caller);
        Task PurgeExpiredAsync(string organizationId, CallerContext caller);
        Task<IReadOnlyList<TrashedFile>> TrashAsync(string organizationId, CallerContext caller);
        Task<IReadOnlyList<string>> ListAsync(string organizationId, CallerContext caller);
        Task<object?> GetByIdAsync(string id, string organizationId, CallerContext caller);
        Task<bool> ExistsAsync(string id);
        Task<DateTimeOffset?> DeletedAtAsync(string id);
        Task<int> LiveCountAsync(string organizationId);
        Task BackdateAsync(string id, int days);
    }

    private record TrashedFile(string Id, string FileName, int DaysRemaining);

    private class ImageSubject(OrganizationImageService service, IDbContextFactory<PresentationContext> factory)
        : IMediaTrashSubject
    {
        public async Task<string> AddAsync(string organizationId, string fileName, CallerContext caller) =>
            (await service.AddImageAsync(organizationId, fileName, "image/jpeg", [1], [1], caller)).Id;

        public Task DeleteAsync(string id, string organizationId, CallerContext caller) =>
            service.DeleteImageAsync(id, organizationId, caller);

        public Task RestoreAsync(string id, string organizationId, CallerContext caller) =>
            service.RestoreImageAsync(id, organizationId, caller);

        public Task PermanentlyDeleteAsync(string id, string organizationId, CallerContext caller) =>
            service.PermanentlyDeleteImageAsync(id, organizationId, caller);

        public Task EmptyTrashAsync(string organizationId, CallerContext caller) =>
            service.EmptyImageTrashAsync(organizationId, caller);

        public Task PurgeExpiredAsync(string organizationId, CallerContext caller) =>
            service.PurgeExpiredImagesAsync(organizationId, caller);

        public async Task<IReadOnlyList<TrashedFile>> TrashAsync(string organizationId, CallerContext caller) =>
            (await service.GetTrashedImagesAsync(organizationId, caller))
                .Select(x => new TrashedFile(x.Id, x.FileName, x.DaysRemaining)).ToList();

        public async Task<IReadOnlyList<string>> ListAsync(string organizationId, CallerContext caller) =>
            (await service.GetImagesAsync(organizationId, caller)).Select(x => x.Id).ToList();

        public async Task<object?> GetByIdAsync(string id, string organizationId, CallerContext caller) =>
            await service.GetImageByIdAsync(id, organizationId, caller);

        public async Task<bool> ExistsAsync(string id)
        {
            await using var context = await factory.CreateDbContextAsync();
            return await context.OrganizationImages.AnyAsync(x => x.Id == id);
        }

        public async Task<DateTimeOffset?> DeletedAtAsync(string id)
        {
            await using var context = await factory.CreateDbContextAsync();
            return (await context.OrganizationImages.SingleAsync(x => x.Id == id)).DeletedAt;
        }

        public async Task<int> LiveCountAsync(string organizationId)
        {
            await using var context = await factory.CreateDbContextAsync();
            return await context.OrganizationImages.NotDeleted().CountAsync(x => x.OrganizationId == organizationId);
        }

        public async Task BackdateAsync(string id, int days)
        {
            await using var context = await factory.CreateDbContextAsync();
            await context.OrganizationImages.Where(x => x.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.DeletedAt, DateTimeOffset.UtcNow.AddDays(-days)));
        }
    }

    private class AudioSubject(OrganizationAudioService service, IDbContextFactory<PresentationContext> factory)
        : IMediaTrashSubject
    {
        public async Task<string> AddAsync(string organizationId, string fileName, CallerContext caller) =>
            (await service.AddAudioAsync(organizationId, fileName, "audio/mpeg", [1], caller)).Id;

        public Task DeleteAsync(string id, string organizationId, CallerContext caller) =>
            service.DeleteAudioAsync(id, organizationId, caller);

        public Task RestoreAsync(string id, string organizationId, CallerContext caller) =>
            service.RestoreAudioAsync(id, organizationId, caller);

        public Task PermanentlyDeleteAsync(string id, string organizationId, CallerContext caller) =>
            service.PermanentlyDeleteAudioAsync(id, organizationId, caller);

        public Task EmptyTrashAsync(string organizationId, CallerContext caller) =>
            service.EmptyAudioTrashAsync(organizationId, caller);

        public Task PurgeExpiredAsync(string organizationId, CallerContext caller) =>
            service.PurgeExpiredAudiosAsync(organizationId, caller);

        public async Task<IReadOnlyList<TrashedFile>> TrashAsync(string organizationId, CallerContext caller) =>
            (await service.GetTrashedAudiosAsync(organizationId, caller))
                .Select(x => new TrashedFile(x.Id, x.FileName, x.DaysRemaining)).ToList();

        public async Task<IReadOnlyList<string>> ListAsync(string organizationId, CallerContext caller) =>
            (await service.GetAudiosAsync(organizationId, caller)).Select(x => x.Id).ToList();

        public async Task<object?> GetByIdAsync(string id, string organizationId, CallerContext caller) =>
            await service.GetAudioByIdAsync(id, organizationId, caller);

        public async Task<bool> ExistsAsync(string id)
        {
            await using var context = await factory.CreateDbContextAsync();
            return await context.OrganizationAudios.AnyAsync(x => x.Id == id);
        }

        public async Task<DateTimeOffset?> DeletedAtAsync(string id)
        {
            await using var context = await factory.CreateDbContextAsync();
            return (await context.OrganizationAudios.SingleAsync(x => x.Id == id)).DeletedAt;
        }

        public async Task<int> LiveCountAsync(string organizationId)
        {
            await using var context = await factory.CreateDbContextAsync();
            return await context.OrganizationAudios.NotDeleted().CountAsync(x => x.OrganizationId == organizationId);
        }

        public async Task BackdateAsync(string id, int days)
        {
            await using var context = await factory.CreateDbContextAsync();
            await context.OrganizationAudios.Where(x => x.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.DeletedAt, DateTimeOffset.UtcNow.AddDays(-days)));
        }
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    /// <summary>Records what was deleted, so a test can assert that nothing was.</summary>
    private class RecordingObjectStorageService : IObjectStorageService
    {
        public List<string> DeletedPrefixes { get; } = [];

        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default)
        {
            DeletedPrefixes.Add(key);
            return Task.CompletedTask;
        }

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
        {
            DeletedPrefixes.Add(prefix);
            return Task.CompletedTask;
        }

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
