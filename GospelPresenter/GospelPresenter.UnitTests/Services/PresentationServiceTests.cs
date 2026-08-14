using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Covers the organization boundary on writes. The interesting attack is a caller who legitimately
/// owns organization A passing its own organization id together with a presentation or item id
/// belonging to organization B: the permission check passes, so only a check on the target row
/// stops the write.
/// </summary>
public class PresentationServiceTests : IDisposable
{
    private const string OrgAName = "Org A";
    private const string OrgBName = "Org B";
    private const string PresentationAId = "presentation-a";
    private const string PresentationBId = "presentation-b";
    private const string ItemAId = "item-a";
    private const string ItemBId = "item-b";
    private const string ItemTitle = "Amazing Grace";
    private const string UnknownPresentationId = "no-such-presentation";
    private const string PresentationNotFound = "Presentation not found.";
    private const string ItemNotFound = "Presentation item not found.";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly PresentationService service;
    private readonly Organization orgA;
    private readonly Organization orgB;
    private readonly CallerContext callerA;
    private readonly CallerContext superAdmin;

    public PresentationServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        service = new PresentationService(factory, new StubObjectStorageService());

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        orgA = new Organization { Name = OrgAName };
        orgB = new Organization { Name = OrgBName };
        context.Organizations.AddRange(orgA, orgB);
        context.SaveChanges();

        // Presentation.Id has no generated value, so it must be assigned explicitly.
        context.Presentations.AddRange(
            new Presentation { Id = PresentationAId, Name = "Sunday A", OrganizationId = orgA.Id },
            new Presentation { Id = PresentationBId, Name = "Sunday B", OrganizationId = orgB.Id });
        context.PresentationItems.AddRange(
            new PresentationItem { Id = ItemAId, Title = ItemTitle, PresentationId = PresentationAId },
            new PresentationItem { Id = ItemBId, Title = ItemTitle, PresentationId = PresentationBId });
        context.SaveChanges();

        callerA = new CallerContext("user-a", UserRole.Admin, orgA.Id);
        superAdmin = new CallerContext("root", UserRole.SuperAdmin, null);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task UpdatePresentationThemeAsync_WithABuiltInTheme_StoresIt()
    {
        // Arrange
        await SeedBuiltInThemesAsync();

        // Act
        await service.UpdatePresentationThemeAsync(orgA.Id, PresentationAId, BuiltInThemes.ClassicId, callerA);

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Presentations.SingleAsync(x => x.Id == PresentationAId);
        stored.ThemeId.ShouldBe(BuiltInThemes.ClassicId);
    }

    [Fact]
    public async Task UpdatePresentationThemeAsync_WithNull_FallsBackToTheOrganizationDefault()
    {
        // Arrange
        await SeedBuiltInThemesAsync();
        await service.UpdatePresentationThemeAsync(orgA.Id, PresentationAId, BuiltInThemes.ClassicId, callerA);

        // Act
        await service.UpdatePresentationThemeAsync(orgA.Id, PresentationAId, null, callerA);

        // Assert -- null is how a presentation says "follow the organisation"
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Presentations.SingleAsync(x => x.Id == PresentationAId);
        stored.ThemeId.ShouldBeNull();
    }

    /// <summary>
    /// The theme id arrives from the client, so a caller could name a theme belonging to another
    /// organization and dress their own slides in it.
    /// </summary>
    [Fact]
    public async Task UpdatePresentationThemeAsync_WithAnotherOrganizationsTheme_Throws()
    {
        // Arrange
        await using (var seed = await factory.CreateDbContextAsync())
        {
            seed.Themes.Add(new Theme { Id = "theirs", OrganizationId = orgB.Id, Name = "Theirs" });
            await seed.SaveChangesAsync();
        }

        // Act
        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.UpdatePresentationThemeAsync(orgA.Id, PresentationAId, "theirs", callerA));

        // Assert
        exception.Message.ShouldBe("Theme not found.");
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Presentations.SingleAsync(x => x.Id == PresentationAId);
        stored.ThemeId.ShouldBeNull();
    }

    [Fact]
    public async Task UpdatePresentationThemeAsync_WithOwnOrganizationIdButForeignPresentationId_ChangesNothing()
    {
        // Arrange
        await SeedBuiltInThemesAsync();

        // Act -- the caller's own organization id, so the permission check passes
        await service.UpdatePresentationThemeAsync(orgA.Id, PresentationBId, BuiltInThemes.ClassicId, callerA);

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.Presentations.SingleAsync(x => x.Id == PresentationBId);
        stored.ThemeId.ShouldBeNull();
    }

    private async Task SeedBuiltInThemesAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        await BuiltInThemeSeeder.SeedAsync(context);
    }

    [Fact]
    public async Task AddItemAsync_ForAPresentationInTheCallersOwnOrganization_AddsTheItem()
    {
        // Arrange
        var item = NewItem();

        // Act
        await service.AddItemAsync(orgA.Id, PresentationAId, item, callerA);

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.PresentationItems.SingleAsync(x => x.Id == item.Id);
        stored.PresentationId.ShouldBe(PresentationAId);
        stored.Title.ShouldBe(ItemTitle);
        stored.SortOrder.ShouldBe(1);
    }

    [Fact]
    public async Task AddItemAsync_WithOwnOrganizationIdButForeignPresentationId_Throws()
    {
        // Arrange -- the caller's own organization id, so the permission check passes
        var item = NewItem();

        // Act
        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.AddItemAsync(orgA.Id, PresentationBId, item, callerA));

        // Assert
        exception.Message.ShouldBe(PresentationNotFound);
    }

    [Fact]
    public async Task AddItemAsync_WithOwnOrganizationIdButForeignPresentationId_LeavesTheOtherOrganizationUntouched()
    {
        // Arrange
        var item = NewItem();

        // Act
        await Should.ThrowAsync<InvalidOperationException>(
            () => service.AddItemAsync(orgA.Id, PresentationBId, item, callerA));

        // Assert -- only the seeded item remains in the other organization
        await using var context = await factory.CreateDbContextAsync();
        var count = await context.PresentationItems.CountAsync(x => x.PresentationId == PresentationBId);
        count.ShouldBe(1);
    }

    [Fact]
    public async Task AddItemAsync_WithUnknownPresentationId_ThrowsAndStoresNothing()
    {
        // Arrange
        var item = NewItem();

        // Act
        await Should.ThrowAsync<InvalidOperationException>(
            () => service.AddItemAsync(orgA.Id, UnknownPresentationId, item, callerA));

        // Assert -- an unverified insert would leave an orphan row behind
        await using var context = await factory.CreateDbContextAsync();
        var orphans = await context.PresentationItems.CountAsync(x => x.PresentationId == UnknownPresentationId);
        orphans.ShouldBe(0);
    }

    [Fact]
    public async Task AddItemAsync_AsSuperAdminWithMismatchedOrganizationAndPresentation_Throws()
    {
        // Arrange -- a SuperAdmin has cross-organization access, so the permission check is a
        // no-op here; only the check on the target presentation can reject this.
        var item = NewItem();

        // Act
        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.AddItemAsync(orgA.Id, PresentationBId, item, superAdmin));

        // Assert
        exception.Message.ShouldBe(PresentationNotFound);
    }

    [Fact]
    public async Task AddItemAsync_WhenCallerBelongsToAnotherOrganization_ThrowsUnauthorized()
    {
        // Arrange -- documents the pre-existing permission check. The exception type is what
        // separates it from the organization-boundary check on the target row.
        var item = NewItem();

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.AddItemAsync(orgB.Id, PresentationBId, item, callerA));
    }

    [Fact]
    public async Task AddItemPartsAsync_ForAnItemInTheCallersOwnOrganization_AddsTheParts()
    {
        // Arrange
        var parts = new List<PresentationItemPart>
        {
            new() { Content = "Verse 1" },
            new() { Content = "Verse 2" },
        };

        // Act
        await service.AddItemPartsAsync(orgA.Id, PresentationAId, ItemAId, parts, callerA);

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.PresentationItemParts
            .Where(x => x.PresentationItemId == ItemAId)
            .OrderBy(x => x.SortOrder)
            .ToListAsync();
        stored.Select(x => x.Content).ShouldBe(["Verse 1", "Verse 2"]);
        stored.Select(x => x.SortOrder).ShouldBe([0, 1]);
    }

    [Fact]
    public async Task AddItemPartsAsync_WithOwnOrganizationIdButForeignPresentationAndItemIds_ThrowsAndAddsNoParts()
    {
        // Arrange
        var parts = new List<PresentationItemPart> { new() { Content = "Injected" } };

        // Act
        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.AddItemPartsAsync(orgA.Id, PresentationBId, ItemBId, parts, callerA));

        // Assert
        exception.Message.ShouldBe(ItemNotFound);
        await using var context = await factory.CreateDbContextAsync();
        var count = await context.PresentationItemParts.CountAsync(x => x.PresentationItemId == ItemBId);
        count.ShouldBe(0);
    }

    [Fact]
    public async Task AddItemPartsAsync_WithOwnPresentationIdButForeignItemId_ThrowsAndAddsNoParts()
    {
        // Arrange -- own organization and own presentation, but another organization's item.
        // Parts are keyed on the item id alone, so nothing else would catch this.
        var parts = new List<PresentationItemPart> { new() { Content = "Injected" } };

        // Act
        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.AddItemPartsAsync(orgA.Id, PresentationAId, ItemBId, parts, callerA));

        // Assert
        exception.Message.ShouldBe(ItemNotFound);
        await using var context = await factory.CreateDbContextAsync();
        var count = await context.PresentationItemParts.CountAsync(x => x.PresentationItemId == ItemBId);
        count.ShouldBe(0);
    }

    // AddItemAsync mutates the instance it is given, so every test needs its own.
    private static PresentationItem NewItem() =>
        new() { Title = ItemTitle, Type = PresentationItemType.Song };

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    // AddItemAsync and AddItemPartsAsync never touch object storage; throwing makes an accidental
    // dependency loud instead of letting it pass silently.
    private class StubObjectStorageService : IObjectStorageService
    {
        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
