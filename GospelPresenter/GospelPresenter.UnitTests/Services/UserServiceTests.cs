using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class UserServiceTests : IDisposable
{
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
        service = new UserService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = "Test Org" };
        user = new User
        {
            Name = "Test User",
            Email = "test@example.com",
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

    // Self-edit: should succeed without ManageUsers permission
    [Fact]
    public async Task UpdateUserAsync_SelfEdit_Succeeds_WithoutManageUsers()
    {
        var caller = CallerFor(user);

        await service.UpdateUserAsync(user.Id, "New Name", user.Email, user.Role, caller);

        using var context = factory.CreateDbContext();
        var updated = await context.Users.FirstAsync(u => u.Id == user.Id);
        updated.Name.ShouldBe("New Name");
    }

    // Self-edit: cannot change own role
    [Fact]
    public async Task UpdateUserAsync_SelfEdit_CannotChangeOwnRole()
    {
        var caller = CallerFor(user);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(user.Id, user.Name, user.Email, UserRole.Admin, caller));
    }

    // Edit other user: requires ManageUsers permission
    [Fact]
    public async Task UpdateUserAsync_EditOther_RequiresManageUsers()
    {
        var otherUser = new User
        {
            Name = "Other",
            Email = "other@example.com",
            Role = UserRole.User,
            OrganizationId = org.Id
        };
        using (var context = factory.CreateDbContext())
        {
            context.Users.Add(otherUser);
            await context.SaveChangesAsync();
        }

        // User role does not have ManageUsers
        var caller = CallerFor(user);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(otherUser.Id, "Changed", otherUser.Email, otherUser.Role, caller));
    }

    // Edit other user: Admin (has ManageUsers) can edit within same org
    [Fact]
    public async Task UpdateUserAsync_EditOther_AdminSucceeds()
    {
        var admin = new User
        {
            Name = "Admin",
            Email = "admin@example.com",
            Role = UserRole.Admin,
            OrganizationId = org.Id
        };
        var otherUser = new User
        {
            Name = "Other",
            Email = "other@example.com",
            Role = UserRole.User,
            OrganizationId = org.Id
        };
        using (var context = factory.CreateDbContext())
        {
            context.Users.AddRange(admin, otherUser);
            await context.SaveChangesAsync();
        }

        var caller = CallerFor(admin);

        await service.UpdateUserAsync(otherUser.Id, "Renamed", otherUser.Email, otherUser.Role, caller);

        using var verifyContext = factory.CreateDbContext();
        var updated = await verifyContext.Users.FirstAsync(u => u.Id == otherUser.Id);
        updated.Name.ShouldBe("Renamed");
    }

    // Edit other user: cannot edit user in different org without CrossOrganizationAccess
    [Fact]
    public async Task UpdateUserAsync_EditOther_DifferentOrg_Denied()
    {
        var otherOrg = new Organization { Name = "Other Org" };
        var otherUser = new User
        {
            Name = "Other",
            Email = "other@example.com",
            Role = UserRole.User,
            OrganizationId = otherOrg.Id
        };
        var admin = new User
        {
            Name = "Admin",
            Email = "admin@example.com",
            Role = UserRole.Admin,
            OrganizationId = org.Id
        };
        using (var context = factory.CreateDbContext())
        {
            context.Organizations.Add(otherOrg);
            context.Users.AddRange(admin, otherUser);
            await context.SaveChangesAsync();
        }

        var caller = CallerFor(admin);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(otherUser.Id, "Changed", otherUser.Email, otherUser.Role, caller));
    }

    // Cannot assign SuperAdmin without AssignSuperAdminRole permission
    [Fact]
    public async Task UpdateUserAsync_AssignSuperAdmin_DeniedForAdmin()
    {
        var admin = new User
        {
            Name = "Admin",
            Email = "admin@example.com",
            Role = UserRole.Admin,
            OrganizationId = org.Id
        };
        using (var context = factory.CreateDbContext())
        {
            context.Users.Add(admin);
            await context.SaveChangesAsync();
        }

        var caller = CallerFor(admin);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.UpdateUserAsync(user.Id, user.Name, user.Email, UserRole.SuperAdmin, caller));
    }

    // SuperAdmin can assign SuperAdmin role
    [Fact]
    public async Task UpdateUserAsync_AssignSuperAdmin_AllowedForSuperAdmin()
    {
        var superAdmin = new User
        {
            Name = "Super",
            Email = "super@example.com",
            Role = UserRole.SuperAdmin,
            OrganizationId = org.Id
        };
        using (var context = factory.CreateDbContext())
        {
            context.Users.Add(superAdmin);
            await context.SaveChangesAsync();
        }

        var caller = CallerFor(superAdmin);

        await service.UpdateUserAsync(user.Id, user.Name, user.Email, UserRole.SuperAdmin, caller);

        using var verifyContext = factory.CreateDbContext();
        var updated = await verifyContext.Users.FirstAsync(u => u.Id == user.Id);
        updated.Role.ShouldBe(UserRole.SuperAdmin);
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
