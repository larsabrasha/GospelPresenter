using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The presentation trash: deleting hides without destroying, restoring brings it back whole, and
/// only the purge is final.
///
/// The tests that matter most here are the ones asserting that a trashed presentation is invisible
/// to the ordinary read paths. Soft deletion is filtered explicitly rather than by a global query
/// filter (see <see cref="TrashQueries"/>), so a new read path that forgets to filter is a
/// mistake no compiler catches — these are what catch it.
/// </summary>
public class PresentationTrashTests : IDisposable
{
    private const string OrgAName = "Org A";
    private const string OrgBName = "Org B";
    private const string PresentationId = "presentation-a";
    private const string TemplateId = "template-a";
    private const string OtherOrgPresentationId = "presentation-b";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly RecordingObjectStorageService storage = new();
    private readonly PresentationService service;
    private readonly Organization orgA;
    private readonly Organization orgB;
    private readonly CallerContext callerA;

    public PresentationTrashTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        service = new PresentationService(factory, storage);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        orgA = new Organization { Name = OrgAName };
        orgB = new Organization { Name = OrgBName };
        context.Organizations.AddRange(orgA, orgB);
        context.SaveChanges();

        context.Presentations.AddRange(
            new Presentation { Id = PresentationId, Name = "Sunday", OrganizationId = orgA.Id, EventDate = new DateOnly(2026, 9, 6) },
            new Presentation
            {
                Id = TemplateId, Name = "Sunday template", OrganizationId = orgA.Id, IsTemplate = true,
                ScheduledDayOfWeek = 0, ScheduledTime = new TimeOnly(11, 0), EventLocation = "Stora salen"
            },
            new Presentation { Id = OtherOrgPresentationId, Name = "Sunday B", OrganizationId = orgB.Id });
        context.PresentationItems.Add(new PresentationItem
        {
            Id = "item-a", Title = "Amazing Grace", PresentationId = PresentationId, Type = PresentationItemType.Song
        });
        context.SaveChanges();

        callerA = new CallerContext("user-a", UserRole.Admin, orgA.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Delete_KeepsTheRowAndItsItems()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        var presentation = await context.Presentations.SingleAsync(p => p.Id == PresentationId);
        presentation.DeletedAt.ShouldNotBeNull();
        (await context.PresentationItems.CountAsync(i => i.PresentationId == PresentationId)).ShouldBe(1);
    }

    [Fact]
    public async Task Delete_LeavesTheSlideFilesAlone()
    {
        await SeedSlidesAsync();

        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        // The whole point of the trash: a restore has to find the pages still there.
        storage.DeletedPrefixes.ShouldBeEmpty();
    }

    [Fact]
    public async Task Delete_HidesItFromEveryReadPath()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        (await service.GetPresentationByIdAsync(PresentationId, orgA.Id, callerA)).ShouldBeNull();
        (await service.GetRecentPresentationSummariesAsync(orgA.Id, callerA))
            .ShouldNotContain(p => p.Id == PresentationId);

        var page = await service.GetPresentationSummariesPageAsync(orgA.Id, 0, 50, callerA);
        page.Items.ShouldNotContain(p => p.Id == PresentationId);
        page.TotalCount.ShouldBe(0);

        var dashboard = await service.GetDashboardPresentationsAsync(orgA.Id, new DateOnly(2026, 9, 6), callerA);
        dashboard.Today.ShouldBeEmpty();
        dashboard.Upcoming.ShouldBeEmpty();
    }

    [Fact]
    public async Task Delete_RefusesToTrashATemplate()
    {
        // Templates are still deleted outright by DeleteTemplateAsync; this path must not half-do it.
        await service.DeletePresentationAsync(orgA.Id, TemplateId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.SingleAsync(p => p.Id == TemplateId)).DeletedAt.ShouldBeNull();
    }

    [Fact]
    public async Task Trash_ListsWhatWasDeletedAndNothingElse()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        var trash = await service.GetTrashedPresentationsAsync(orgA.Id, callerA);

        var trashed = trash.ShouldHaveSingleItem();
        trashed.Id.ShouldBe(PresentationId);
        trashed.Name.ShouldBe("Sunday");
        trashed.EventDate.ShouldBe(new DateOnly(2026, 9, 6));
        trashed.DaysRemaining.ShouldBe(AppConstraints.TrashRetentionDays);
    }

    [Fact]
    public async Task Trash_DoesNotReachAnotherOrganisation()
    {
        await service.DeletePresentationAsync(orgB.Id, OtherOrgPresentationId,
            new CallerContext("user-b", UserRole.Admin, orgB.Id));

        (await service.GetTrashedPresentationsAsync(orgA.Id, callerA)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Restore_BringsItBackIntoTheOrdinaryLists()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        await service.RestorePresentationAsync(orgA.Id, PresentationId, callerA);

        (await service.GetTrashedPresentationsAsync(orgA.Id, callerA)).ShouldBeEmpty();
        var restored = await service.GetPresentationByIdAsync(PresentationId, orgA.Id, callerA);
        restored.ShouldNotBeNull();
        restored.Items.ShouldHaveSingleItem().Title.ShouldBe("Amazing Grace");
    }

    [Fact]
    public async Task Restore_FromAnotherOrganisationDoesNothing()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        var callerB = new CallerContext("user-b", UserRole.Admin, orgB.Id);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.RestorePresentationAsync(orgA.Id, PresentationId, callerB));

        (await service.GetTrashedPresentationsAsync(orgA.Id, callerA)).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task PermanentDelete_RemovesTheRowItsChildrenAndTheSlideFiles()
    {
        await SeedSlidesAsync();
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        await service.PermanentlyDeletePresentationAsync(orgA.Id, PresentationId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeFalse();
        (await context.PresentationItems.AnyAsync(i => i.PresentationId == PresentationId)).ShouldBeFalse();
        (await context.PresentationSlides.AnyAsync()).ShouldBeFalse();
        storage.DeletedPrefixes.ShouldHaveSingleItem();
    }

    [Fact]
    public async Task PermanentDelete_OfAPresentationNotInTheTrashDoesNothing()
    {
        await service.PermanentlyDeletePresentationAsync(orgA.Id, PresentationId, callerA);

        // Purging reads from the trash only, so a live presentation cannot be destroyed by handing
        // the purge path its id.
        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeTrue();
        (await context.SyncTombstones.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task EmptyTrash_PurgesEveryTrashedPresentationOfThisOrganisationOnly()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await service.DeletePresentationAsync(orgB.Id, OtherOrgPresentationId,
            new CallerContext("user-b", UserRole.Admin, orgB.Id));

        await service.EmptyPresentationTrashAsync(orgA.Id, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeFalse();
        (await context.Presentations.AnyAsync(p => p.Id == OtherOrgPresentationId)).ShouldBeTrue();
    }

    [Fact]
    public async Task Purge_TakesWhatIsPastTheRetentionWindowAndLeavesTheRest()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await BackdateDeletionAsync(PresentationId, AppConstraints.TrashRetentionDays + 1);

        await service.PurgeExpiredPresentationsAsync(orgA.Id, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeFalse();
    }

    [Fact]
    public async Task Purge_LeavesAPresentationTrashedYesterday()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await BackdateDeletionAsync(PresentationId, 1);

        await service.PurgeExpiredPresentationsAsync(orgA.Id, callerA);

        (await service.GetTrashedPresentationsAsync(orgA.Id, callerA)).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task ListingTheTrash_DoesNotPurge()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await BackdateDeletionAsync(PresentationId, AppConstraints.TrashRetentionDays + 1);

        // Listing must not purge. Purging clears object storage, and a storage outage would then
        // stop anyone from opening the trash at all — see TrashService, which sweeps separately.
        (await service.GetTrashedPresentationsAsync(orgA.Id, callerA)).ShouldHaveSingleItem();

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeTrue();
    }

    [Fact]
    public async Task TrashedPresentations_DoNotCountAgainstTheQuota()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        var live = await context.Presentations
            .NotDeleted()
            .CountAsync(p => p.OrganizationId == orgA.Id && !p.IsTemplate);

        live.ShouldBe(0);
    }

    // --- Templates. Same trash, its own list. ---

    [Fact]
    public async Task DeleteTemplate_KeepsTheRowAndHidesItFromTheTemplateLists()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.SingleAsync(p => p.Id == TemplateId)).DeletedAt.ShouldNotBeNull();

        (await service.GetTemplateByIdAsync(TemplateId, orgA.Id, callerA)).ShouldBeNull();
        (await service.GetAllTemplateSummariesAsync(orgA.Id, callerA)).ShouldNotContain(t => t.Id == TemplateId);
        (await service.GetRecentTemplateSummariesAsync(orgA.Id, callerA)).ShouldNotContain(t => t.Id == TemplateId);
    }

    [Fact]
    public async Task DeleteTemplate_LeavesTheSlideFilesAlone()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        storage.DeletedPrefixes.ShouldBeEmpty();
    }

    [Fact]
    public async Task DeleteTemplate_RefusesToTrashAPresentation()
    {
        // The mirror of Delete_RefusesToTrashATemplate: neither delete may reach across.
        await service.DeleteTemplateAsync(orgA.Id, PresentationId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.SingleAsync(p => p.Id == PresentationId)).DeletedAt.ShouldBeNull();
    }

    [Fact]
    public async Task TheTwoTrashes_DoNotShowEachOthersRows()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        (await service.GetTrashedPresentationsAsync(orgA.Id, callerA))
            .ShouldHaveSingleItem().Id.ShouldBe(PresentationId);
        (await service.GetTrashedTemplatesAsync(orgA.Id, callerA))
            .ShouldHaveSingleItem().Id.ShouldBe(TemplateId);
    }

    [Fact]
    public async Task TemplateTrash_CarriesTheWeeklySlotThatTellsTemplatesApart()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        var trashed = (await service.GetTrashedTemplatesAsync(orgA.Id, callerA)).ShouldHaveSingleItem();
        trashed.Name.ShouldBe("Sunday template");
        trashed.ScheduledDayOfWeek.ShouldBe(0);
        trashed.ScheduledTime.ShouldBe(new TimeOnly(11, 0));
        trashed.Location.ShouldBe("Stora salen");
        trashed.DaysRemaining.ShouldBe(AppConstraints.TrashRetentionDays);
    }

    [Fact]
    public async Task RestoreTemplate_BringsItBackIntoTheTemplateList()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        await service.RestoreTemplateAsync(orgA.Id, TemplateId, callerA);

        (await service.GetTrashedTemplatesAsync(orgA.Id, callerA)).ShouldBeEmpty();
        (await service.GetAllTemplateSummariesAsync(orgA.Id, callerA)).ShouldContain(t => t.Id == TemplateId);
    }

    [Fact]
    public async Task ATrashedTemplate_CannotBeUsedToCreateAPresentation()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.CreatePresentationFromTemplateAsync(TemplateId, "Ny", orgA.Id, "user-a", callerA));

        exception.Message.ShouldBe("Template not found.");
    }

    [Fact]
    public async Task PermanentDeleteTemplate_RemovesTheRow()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        await service.PermanentlyDeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == TemplateId)).ShouldBeFalse();
    }

    [Fact]
    public async Task EmptyTemplateTrash_LeavesThePresentationTrashAlone()
    {
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);

        await service.EmptyTemplateTrashAsync(orgA.Id, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == TemplateId)).ShouldBeFalse();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeTrue();
    }

    [Fact]
    public async Task PurgeTemplates_TakesWhatIsPastTheRetentionWindow()
    {
        await service.DeleteTemplateAsync(orgA.Id, TemplateId, callerA);
        await BackdateDeletionAsync(TemplateId, AppConstraints.TrashRetentionDays + 1);

        await service.PurgeExpiredTemplatesAsync(orgA.Id, callerA);

        (await service.GetTrashedTemplatesAsync(orgA.Id, callerA)).ShouldBeEmpty();

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == TemplateId)).ShouldBeFalse();
    }

    [Fact]
    public async Task PurgeTemplates_DoesNotTakeAnExpiredPresentation()
    {
        // The two purges must not reach across either: emptying one trash by age must leave the
        // other's expired rows for its own purge to handle.
        await service.DeletePresentationAsync(orgA.Id, PresentationId, callerA);
        await BackdateDeletionAsync(PresentationId, AppConstraints.TrashRetentionDays + 1);

        await service.PurgeExpiredTemplatesAsync(orgA.Id, callerA);

        await using var context = await factory.CreateDbContextAsync();
        (await context.Presentations.AnyAsync(p => p.Id == PresentationId)).ShouldBeTrue();
    }

    private async Task SeedSlidesAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        context.PresentationSlides.Add(new PresentationSlides
        {
            Id = "slides-1", FileName = "deck.pptx", PageCount = 3, PresentationId = PresentationId
        });
        context.PresentationItems.Add(new PresentationItem
        {
            Id = "slides-item", Title = "Deck", PresentationId = PresentationId,
            Type = PresentationItemType.Slides, SourceId = "slides-1"
        });
        await context.SaveChangesAsync();
    }

    private async Task BackdateDeletionAsync(string presentationId, int days)
    {
        await using var context = await factory.CreateDbContextAsync();
        await context.Presentations
            .Where(p => p.Id == presentationId)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.DeletedAt, DateTimeOffset.UtcNow.AddDays(-days)));
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
            throw new NotSupportedException();

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
