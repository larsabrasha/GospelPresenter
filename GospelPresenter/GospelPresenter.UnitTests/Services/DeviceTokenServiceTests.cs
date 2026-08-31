using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Device tokens are personal credentials: any signed-in user equips their own device, and the
/// boundary under test is "your own account only" — plus that the plaintext never touches the
/// database and that revocation is a kept row, not a delete.
/// </summary>
public class DeviceTokenServiceTests : IDisposable
{
    private const string UserAId = "user-a";
    private const string UserBId = "user-b";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly UserService service;
    private readonly Organization orgA;
    private readonly Organization orgB;
    private readonly CallerContext callerA;

    public DeviceTokenServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        service = new UserService(factory, new SongPartLabelService(factory));

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        orgA = new Organization { Name = "Org A" };
        orgB = new Organization { Name = "Org B" };
        context.Organizations.AddRange(orgA, orgB);
        context.Users.AddRange(
            new User { Id = UserAId, Name = "Anna", Email = "anna@example.com", OrganizationId = orgA.Id },
            new User { Id = UserBId, Name = "Bo", Email = "bo@example.com", OrganizationId = orgB.Id });
        context.SaveChanges();

        callerA = new CallerContext(UserAId, UserRole.User, orgA.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    [Fact]
    public async Task CreateDeviceTokenAsync_ReturnsAPrefixedPlaintextAndStoresOnlyTheHash()
    {
        // Act
        var (token, plaintext) = await service.CreateDeviceTokenAsync("MacBook", UserAId, orgA.Id, callerA);

        // Assert
        plaintext.ShouldStartWith(DeviceToken.Prefix);
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.DeviceTokens.SingleAsync();
        stored.Id.ShouldBe(token.Id);
        stored.TokenHash.ShouldBe(DeviceToken.HashKey(plaintext));
        stored.TokenHash.ShouldNotContain(plaintext);
        stored.RevokedAt.ShouldBeNull();
    }

    [Fact]
    public async Task CreateDeviceTokenAsync_ForAnotherUser_Throws()
    {
        var act = () => service.CreateDeviceTokenAsync("Stolen", UserBId, orgB.Id,
            new CallerContext(UserAId, UserRole.Admin, orgB.Id));

        await Should.ThrowAsync<UnauthorizedAccessException>(act);
    }

    [Fact]
    public async Task CreateDeviceTokenAsync_WhenTheUserIsNotInTheOrganization_Throws()
    {
        // The caller controls both ids; without the membership check a token could be minted
        // binding user A to organization B.
        var act = () => service.CreateDeviceTokenAsync("Mismatch", UserAId, orgB.Id,
            new CallerContext(UserAId, UserRole.SuperAdmin, null));

        var exception = await Should.ThrowAsync<InvalidOperationException>(act);
        exception.Message.ShouldBe("User not found.");
    }

    [Fact]
    public async Task CreateDeviceTokenAsync_BeyondTheCap_Throws()
    {
        // Arrange
        for (var i = 0; i < AppConstraints.MaxDeviceTokensPerUser; i++)
            await service.CreateDeviceTokenAsync($"Device {i}", UserAId, orgA.Id, callerA);

        // Act & Assert
        await Should.ThrowAsync<InvalidOperationException>(
            () => service.CreateDeviceTokenAsync("One too many", UserAId, orgA.Id, callerA));
    }

    [Fact]
    public async Task RevokeDeviceTokenAsync_KeepsTheRowAndSetsRevokedAt()
    {
        // Arrange
        var (token, _) = await service.CreateDeviceTokenAsync("MacBook", UserAId, orgA.Id, callerA);

        // Act
        await service.RevokeDeviceTokenAsync(token.Id, callerA);

        // Assert
        await using var context = await factory.CreateDbContextAsync();
        var stored = await context.DeviceTokens.SingleAsync();
        stored.RevokedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task RevokeDeviceTokenAsync_ForAnotherUsersToken_Throws()
    {
        // Arrange
        var (token, _) = await service.CreateDeviceTokenAsync("MacBook", UserAId, orgA.Id, callerA);

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.RevokeDeviceTokenAsync(token.Id, new CallerContext(UserBId, UserRole.Admin, orgB.Id)));
    }

    [Fact]
    public async Task GetDeviceTokensAsync_ForAnotherUser_Throws()
    {
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.GetDeviceTokensAsync(UserAId, new CallerContext(UserBId, UserRole.Admin, orgB.Id)));
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
