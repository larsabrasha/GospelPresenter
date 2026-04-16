using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class UserServiceTests : IDisposable
{
    private const string DefaultOrgName = "Test Org";
    private const string DefaultUserName = "Test User";
    private const string DefaultUserEmail = "test@example.com";
    private const string UpdatedName = "Updated Name";
    private const string OtherOrgName = "Other Org";
    private const string OtherUserName = "Other User";
    private const string OtherUserEmail = "other@example.com";
    private const string AdminName = "Admin";
    private const string AdminEmail = "admin@example.com";
    private const string SuperAdminName = "Super Admin";
    private const string SuperAdminEmail = "super@example.com";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly UserService service;
    private readonly Organization org;
    private readonly User user;

    public UserServiceTests()
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

        org = new Organization { Name = DefaultOrgName };
        user = new User
        {
            Name = DefaultUserName,
            Email = DefaultUserEmail,
            Role = UserRole.User,
            OrganizationId = org.Id
        };

        context.Organizations.Add(org);
        context.Users.Add(user);
        context.SaveChanges();
    }

    public void Dispose()
    {
        connection.Dispose();
    }

    private CallerContext CallerFor(User u) => new(u.Id, u.Role, u.OrganizationId);

    [Fact]
    public async Task UpdateUserAsync_SelfEditWithoutManageUsers_Succeeds()
    {
        // Arrange
        var caller = CallerFor(user);

        // Act
        await service.UpdateUserAsync(user.Id, UpdatedName, user.Email, user.Role, caller);

        // Assert
        using var context = factory.CreateDbContext();
        var updated = await context.Users.FirstAsync(u => u.Id == user.Id);
        updated.Name.ShouldBe(UpdatedName);
    }

    [Fact]
    public async Task UpdateUserAsync_SelfEditChangingOwnRole_ThrowsUnauthorized()
    {
        // Arrange
        var caller = CallerFor(user);

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(user.Id, user.Name, user.Email, UserRole.Admin, caller));
    }

    [Fact]
    public async Task UpdateUserAsync_EditOtherUserWithoutManageUsers_ThrowsUnauthorized()
    {
        // Arrange
        var otherUser = AddUser(OtherUserName, OtherUserEmail, UserRole.User, org.Id);
        var caller = CallerFor(user);

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(otherUser.Id, UpdatedName, otherUser.Email, otherUser.Role, caller));
    }

    [Fact]
    public async Task UpdateUserAsync_AdminEditingSameOrgUser_Succeeds()
    {
        // Arrange
        var admin = AddUser(AdminName, AdminEmail, UserRole.Admin, org.Id);
        var otherUser = AddUser(OtherUserName, OtherUserEmail, UserRole.User, org.Id);
        var caller = CallerFor(admin);

        // Act
        await service.UpdateUserAsync(otherUser.Id, UpdatedName, otherUser.Email, otherUser.Role, caller);

        // Assert
        using var verifyContext = factory.CreateDbContext();
        var updated = await verifyContext.Users.FirstAsync(u => u.Id == otherUser.Id);
        updated.Name.ShouldBe(UpdatedName);
    }

    [Fact]
    public async Task UpdateUserAsync_AdminEditingDifferentOrgUser_ThrowsUnauthorized()
    {
        // Arrange
        var otherOrg = new Organization { Name = OtherOrgName };
        using (var context = factory.CreateDbContext())
        {
            context.Organizations.Add(otherOrg);
            await context.SaveChangesAsync();
        }
        var otherUser = AddUser(OtherUserName, OtherUserEmail, UserRole.User, otherOrg.Id);
        var admin = AddUser(AdminName, AdminEmail, UserRole.Admin, org.Id);
        var caller = CallerFor(admin);

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(otherUser.Id, UpdatedName, otherUser.Email, otherUser.Role, caller));
    }

    [Fact]
    public async Task UpdateUserAsync_AdminAssigningSuperAdmin_ThrowsUnauthorized()
    {
        // Arrange
        var admin = AddUser(AdminName, AdminEmail, UserRole.Admin, org.Id);
        var caller = CallerFor(admin);

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(user.Id, user.Name, user.Email, UserRole.SuperAdmin, caller));
    }

    [Fact]
    public async Task UpdateUserAsync_SuperAdminAssigningSuperAdmin_Succeeds()
    {
        // Arrange
        var superAdmin = AddUser(SuperAdminName, SuperAdminEmail, UserRole.SuperAdmin, org.Id);
        var caller = CallerFor(superAdmin);

        // Act
        await service.UpdateUserAsync(user.Id, user.Name, user.Email, UserRole.SuperAdmin, caller);

        // Assert
        using var verifyContext = factory.CreateDbContext();
        var updated = await verifyContext.Users.FirstAsync(u => u.Id == user.Id);
        updated.Role.ShouldBe(UserRole.SuperAdmin);
    }

    private User AddUser(string name, string email, UserRole role, string organizationId)
    {
        var newUser = new User
        {
            Name = name,
            Email = email,
            Role = role,
            OrganizationId = organizationId
        };
        using var context = factory.CreateDbContext();
        context.Users.Add(newUser);
        context.SaveChanges();
        return newUser;
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
