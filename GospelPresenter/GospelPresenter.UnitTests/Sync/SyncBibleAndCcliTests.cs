using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// The two side channels next to the row sync: Bible verse downloads (one-way, per pinned
/// translation) and CCLI entries recorded while presenting offline (append-only, idempotent,
/// dated by the client — the display happened when the projector ran, not when the device got
/// back online).
/// </summary>
public class SyncBibleAndCcliTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly Organization orgA;
    private readonly Organization orgB;
    private readonly CallerContext callerA;

    public SyncBibleAndCcliTests()
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
        context.Users.Add(new User { Id = "user-1", Name = "Anna", Email = "anna@example.com", OrganizationId = orgA.Id });
        context.Bibles.AddRange(
            new DbBible { Id = "bible-a", Name = "Bibel 2000", Abbreviation = "B2000", VersesJson = """[{"b":"GEN","c":1,"v":1,"t":"I begynnelsen"}]""", VerseCount = 1, OrganizationId = orgA.Id },
            new DbBible { Id = "bible-b", Name = "Theirs", Abbreviation = "X", VersesJson = "[]", OrganizationId = orgB.Id });
        context.OrganizationSettings.Add(new OrganizationSetting
        {
            OrganizationId = orgA.Id,
            Key = OrganizationSetting.CcliCollectionEnabled,
            Value = "true"
        });
        context.SaveChanges();

        callerA = new CallerContext("user-1", UserRole.User, orgA.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task GetBibleVersesJson_ReturnsTheOrganizationsTranslation()
    {
        var service = SyncServiceFactory.Create(factory);

        var json = await service.GetBibleVersesJsonAsync(orgA.Id, "bible-a", callerA);

        json.ShouldNotBeNull();
        json.ShouldContain("I begynnelsen");
    }

    [Fact]
    public async Task GetBibleVersesJson_ForAnotherOrganizationsBible_ReturnsNull()
    {
        var service = SyncServiceFactory.Create(factory);

        (await service.GetBibleVersesJsonAsync(orgA.Id, "bible-b", callerA)).ShouldBeNull();
    }

    [Fact]
    public async Task RecordEntries_KeepsTheClientsDateAndIsIdempotent()
    {
        // Arrange
        var service = new CcliReportService(factory, NullLogger<CcliReportService>.Instance);
        var offlineDate = new DateOnly(2026, 8, 23);
        var entries = new List<CcliSyncEntry>
        {
            new("song-1", "Amazing Grace", "12345", "pres-1", "Gudstjänst", offlineDate),
            new("song-2", "How Great", "67890", "pres-1", "Gudstjänst", offlineDate),
        };

        // Act -- push twice, as after a lost response
        var first = await service.RecordEntriesAsync(orgA.Id, entries, callerA);
        var second = await service.RecordEntriesAsync(orgA.Id, entries, callerA);

        // Assert
        first.ShouldBe(2);
        second.ShouldBe(0);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.CcliReportEntries.OrderBy(e => e.SongId).ToListAsync();
        stored.Count.ShouldBe(2);
        stored.ShouldAllBe(e => e.Date == offlineDate);
    }

    [Fact]
    public async Task RecordEntries_WhenCollectionIsDisabled_RecordsNothing()
    {
        // Arrange -- org B never enabled CCLI collection
        var service = new CcliReportService(factory, NullLogger<CcliReportService>.Instance);
        var callerB = new CallerContext("user-b", UserRole.Admin, orgB.Id);

        // Act
        var recorded = await service.RecordEntriesAsync(orgB.Id,
            [new CcliSyncEntry("song-1", "Song", "1", null, "", new DateOnly(2026, 8, 23))], callerB);

        // Assert
        recorded.ShouldBe(0);
        await using var context = await factory.CreateDbContextAsync();
        (await context.CcliReportEntries.AnyAsync()).ShouldBeFalse();
    }

    [Fact]
    public async Task RecordEntries_ForAnotherOrganization_Throws()
    {
        var service = new CcliReportService(factory, NullLogger<CcliReportService>.Instance);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.RecordEntriesAsync(orgB.Id,
                [new CcliSyncEntry("song-1", "Song", "1", null, "", new DateOnly(2026, 8, 23))], callerA));
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
