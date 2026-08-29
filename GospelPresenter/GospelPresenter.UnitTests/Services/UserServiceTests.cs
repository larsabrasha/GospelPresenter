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
    private const string ApiKeyName = "Automation key";
    private const string UnknownUserId = "no-such-user";

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
    public async Task CreateSuperUserAsync_PutsTheFirstAccountInAnOrganization()
    {
        // Act
        var superUser = await service.CreateSuperUserAsync(SuperAdminName, OtherOrgName);

        // Assert -- a device token is always issued for an organisation, so a first account without
        // one could sign in to the web app and nowhere else
        superUser.OrganizationId.ShouldNotBeNull();

        using var context = factory.CreateDbContext();
        var organization = await context.Organizations.FirstAsync(o => o.Id == superUser.OrganizationId);
        organization.Name.ShouldBe(OtherOrgName);

        var labels = await context.SongPartLabels.CountAsync(l => l.OrganizationId == organization.Id);
        labels.ShouldBeGreaterThan(0, "a new organization should get the default song part labels");
    }

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

    // Only SuperAdmin holds ManageMcpApiKeys, and that role also has cross-organization access,
    // so the check that the key's user and organization belong together is the only thing keeping
    // the two columns consistent.

    [Fact]
    public async Task CreateMcpApiKeyAsync_ForAUserInTheGivenOrganization_CreatesTheKey()
    {
        // Arrange
        var caller = CallerFor(AddUser(SuperAdminName, SuperAdminEmail, UserRole.SuperAdmin, org.Id));

        // Act
        var (apiKey, plaintext) = await service.CreateMcpApiKeyAsync(ApiKeyName, user.Id, org.Id, caller);

        // Assert
        apiKey.UserId.ShouldBe(user.Id);
        apiKey.OrganizationId.ShouldBe(org.Id);
        plaintext.ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task CreateMcpApiKeyAsync_ForAUserInAnotherOrganization_ThrowsAndCreatesNoKey()
    {
        // Arrange
        var otherUser = AddUserInNewOrganization();
        var caller = CallerFor(AddUser(SuperAdminName, SuperAdminEmail, UserRole.SuperAdmin, org.Id));

        // Act
        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => service.CreateMcpApiKeyAsync(ApiKeyName, otherUser.Id, org.Id, caller));

        // Assert
        exception.Message.ShouldBe("User not found.");
        using var verifyContext = factory.CreateDbContext();
        (await verifyContext.McpApiKeys.CountAsync(k => k.UserId == otherUser.Id)).ShouldBe(0);
    }

    [Fact]
    public async Task CreateMcpApiKeyAsync_WithUnknownUserId_Throws()
    {
        // Arrange
        var caller = CallerFor(AddUser(SuperAdminName, SuperAdminEmail, UserRole.SuperAdmin, org.Id));

        // Act & Assert
        await Should.ThrowAsync<InvalidOperationException>(
            () => service.CreateMcpApiKeyAsync(ApiKeyName, UnknownUserId, org.Id, caller));
    }

    [Fact]
    public async Task CreateMcpApiKeyAsync_AsAdmin_ThrowsUnauthorized()
    {
        // Arrange -- documents that the permission gate keeps Admin out entirely
        var caller = CallerFor(AddUser(AdminName, AdminEmail, UserRole.Admin, org.Id));

        // Act & Assert
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.CreateMcpApiKeyAsync(ApiKeyName, user.Id, org.Id, caller));
    }

    [Fact]
    public async Task UserExistsAsync_ForExistingUser_ReturnsTrue()
    {
        // Act
        var exists = await service.UserExistsAsync(user.Id);

        // Assert
        exists.ShouldBeTrue();
    }

    [Fact]
    public async Task UserExistsAsync_ForUnknownUser_ReturnsFalse()
    {
        // Act
        var exists = await service.UserExistsAsync(UnknownUserId);

        // Assert
        exists.ShouldBeFalse();
    }

    [Fact]
    public async Task UserExistsAsync_AfterUserIsDeleted_ReturnsFalse()
    {
        // Arrange -- a deleted user must stop revalidating, which is what ends their live session
        var superAdmin = AddUser(SuperAdminName, SuperAdminEmail, UserRole.SuperAdmin, org.Id);
        await service.DeleteUserAsync(user.Id, CallerFor(superAdmin));

        // Act
        var exists = await service.UserExistsAsync(user.Id);

        // Assert
        exists.ShouldBeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task UserExistsAsync_WithBlankId_ReturnsFalse(string id)
    {
        // Act
        var exists = await service.UserExistsAsync(id);

        // Assert
        exists.ShouldBeFalse();
    }

    private User AddUserInNewOrganization()
    {
        var otherOrg = new Organization { Name = OtherOrgName };
        using (var context = factory.CreateDbContext())
        {
            context.Organizations.Add(otherOrg);
            context.SaveChanges();
        }
        return AddUser(OtherUserName, OtherUserEmail, UserRole.User, otherOrg.Id);
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
