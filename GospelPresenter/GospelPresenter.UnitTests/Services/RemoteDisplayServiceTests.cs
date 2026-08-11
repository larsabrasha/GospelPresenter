using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class RemoteDisplayServiceTests : IDisposable
{
    private const string OrgName = "Test Org";
    private const string OtherOrgName = "Other Org";
    private const string ScreenName = "Sanctuary projector";
    private const string PublicOutputName = "Follow along";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly RemoteDisplayService service;
    private readonly Organization org;
    private readonly CallerContext caller;

    public RemoteDisplayServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        service = new RemoteDisplayService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = OrgName };
        context.Organizations.Add(org);
        context.SaveChanges();

        caller = new CallerContext("user-1", UserRole.Admin, org.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task AddDisplayAsync_ByDefault_CreatesAScreen()
    {
        var added = await service.AddDisplayAsync(org.Id, ScreenName, caller);

        added.Kind.ShouldBe(OutputKind.Screen);
    }

    [Fact]
    public async Task AddDisplayAsync_WithPublicQrKind_CreatesAPublicOutput()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);

        added.Kind.ShouldBe(OutputKind.PublicQr);
        added.Name.ShouldBe(PublicOutputName);
    }

    [Fact]
    public async Task AddDisplayAsync_GeneratesASevenCharacterIdentifier()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);

        added.DisplayIdentifier.Length.ShouldBe(7);
    }

    [Fact]
    public async Task GetDisplaysAsync_ReturnsBothKinds()
    {
        await service.AddDisplayAsync(org.Id, ScreenName, caller);
        await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);

        var displays = await service.GetDisplaysAsync(org.Id, caller);

        displays.Count(d => d.Kind == OutputKind.Screen).ShouldBe(1);
        displays.Count(d => d.Kind == OutputKind.PublicQr).ShouldBe(1);
    }

    [Fact]
    public async Task FindPublicOutputAsync_FindsAPublicOutputByItsIdentifier()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);

        var found = await service.FindPublicOutputAsync(added.DisplayIdentifier);

        found.ShouldNotBeNull();
        found.Id.ShouldBe(added.Id);
        found.Organization.Name.ShouldBe(OrgName);
    }

    [Fact]
    public async Task FindPublicOutputAsync_DoesNotFindAScreen()
    {
        var screen = await service.AddDisplayAsync(org.Id, ScreenName, caller);

        // A screen's identifier must not open the public watch page: it was never meant to be
        // handed out to visitors.
        var found = await service.FindPublicOutputAsync(screen.DisplayIdentifier);

        found.ShouldBeNull();
    }

    [Fact]
    public async Task FindPublicOutputAsync_WithUnknownIdentifier_ReturnsNull()
    {
        var found = await service.FindPublicOutputAsync("nosuch1");

        found.ShouldBeNull();
    }

    [Fact]
    public async Task RegenerateIdentifierAsync_ReplacesTheIdentifier()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);
        var original = added.DisplayIdentifier;

        var replacement = await service.RegenerateIdentifierAsync(org.Id, added.Id, caller);

        replacement.ShouldNotBeNull();
        replacement.ShouldNotBe(original);
        replacement.Length.ShouldBe(7);
    }

    [Fact]
    public async Task RegenerateIdentifierAsync_MakesTheOldIdentifierStopWorking()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);
        var original = added.DisplayIdentifier;

        await service.RegenerateIdentifierAsync(org.Id, added.Id, caller);

        (await service.FindPublicOutputAsync(original)).ShouldBeNull();
    }

    [Fact]
    public async Task RegenerateIdentifierAsync_KeepsTheName()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);

        var replacement = await service.RegenerateIdentifierAsync(org.Id, added.Id, caller);

        var found = await service.FindPublicOutputAsync(replacement!);
        found!.Name.ShouldBe(PublicOutputName);
    }

    [Fact]
    public async Task RegenerateIdentifierAsync_ForUnknownOutput_ReturnsNull()
    {
        var replacement = await service.RegenerateIdentifierAsync(org.Id, "no-such-id", caller);

        replacement.ShouldBeNull();
    }

    [Fact]
    public async Task RegenerateIdentifierAsync_WhenCallerBelongsToAnotherOrganization_Throws()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);
        var otherCaller = await CreateCallerInOtherOrganizationAsync();

        await Should.ThrowAsync<UnauthorizedAccessException>(() =>
            service.RegenerateIdentifierAsync(org.Id, added.Id, otherCaller));
    }

    [Fact]
    public async Task RegenerateIdentifierAsync_ForAnOutputInAnotherOrganization_ReturnsNull()
    {
        var added = await service.AddDisplayAsync(org.Id, PublicOutputName, caller, OutputKind.PublicQr);
        var otherCaller = await CreateCallerInOtherOrganizationAsync();

        // Scoping to the caller's own organisation means another organisation's output is simply
        // not found, so its code can never be replaced from outside.
        var replacement = await service.RegenerateIdentifierAsync(
            otherCaller.OrganizationId!, added.Id, otherCaller);

        replacement.ShouldBeNull();
        (await service.FindPublicOutputAsync(added.DisplayIdentifier)).ShouldNotBeNull();
    }

    private async Task<CallerContext> CreateCallerInOtherOrganizationAsync()
    {
        await using var context = await factory.CreateDbContextAsync();
        var otherOrg = new Organization { Name = OtherOrgName };
        context.Organizations.Add(otherOrg);
        await context.SaveChangesAsync();

        return new CallerContext("user-2", UserRole.Admin, otherOrg.Id);
    }

    [Fact]
    public async Task AddDisplayAsync_WithoutPermission_Throws()
    {
        var viewer = new CallerContext("user-3", UserRole.User, org.Id);

        await Should.ThrowAsync<UnauthorizedAccessException>(() =>
            service.AddDisplayAsync(org.Id, PublicOutputName, viewer, OutputKind.PublicQr));
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
