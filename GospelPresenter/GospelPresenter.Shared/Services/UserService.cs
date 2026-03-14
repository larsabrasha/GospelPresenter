using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public record CallerContext(string UserId, UserRole Role, string? OrganizationId)
{
    public void RequireOrganizationAccess(string organizationId)
    {
        if (Role != UserRole.SuperAdmin && OrganizationId != organizationId)
            throw new UnauthorizedAccessException("Access denied: you do not have access to this organization.");
    }

    public void RequireSuperAdmin()
    {
        if (Role != UserRole.SuperAdmin)
            throw new UnauthorizedAccessException("Access denied: this action requires SuperAdmin privileges.");
    }

    public void RequireUserAccess(string targetUserId)
    {
        if (Role != UserRole.SuperAdmin && UserId != targetUserId)
            throw new UnauthorizedAccessException("Access denied: you can only access your own data.");
    }
}

public interface IUserService
{
    Task<User?> GetByLoginAsync(string provider, string providerSubjectId);
    Task<UserLogin> LinkLoginAsync(string userId, string provider, string providerSubjectId);
    Task<Invite?> GetInviteByTokenAsync(string token);
    Task<bool> IsInviteExpiredAsync(string token);
    Task MarkInviteUsedAsync(string inviteId);

    Task<bool> IsEmailTakenAsync(string email, string? excludeUserId = null);
    Task<List<User>> GetAllUsersAsync(CallerContext caller);
    Task<User?> GetByIdAsync(string id, CallerContext caller);
    Task<User> CreateUserAsync(string name, string email, string organizationId, UserRole role, CallerContext caller);
    Task<User> CreateSuperUserAsync(string name);
    Task UpdateUserAsync(string id, string name, string email, UserRole role, CallerContext caller);
    Task UpdateEmailIfEmptyAsync(string id, string email);
    Task UpdateProfileImageAsync(string id, string? profileImage, string? profileImageSmall);
    Task UpdateProfileImageAsync(string id, string? profileImage, string? profileImageSmall, CallerContext caller);
    Task DeleteUserAsync(string id, CallerContext caller);

    Task<List<UserLogin>> GetLoginsForUserAsync(string userId, CallerContext caller);
    Task DeleteLoginAsync(string loginId, CallerContext caller);

    Task<List<Invite>> GetInvitesForUserAsync(string userId, CallerContext caller);
    Task<Invite> CreateInviteAsync(string userId, CallerContext caller);
    Task DeleteInviteAsync(string inviteId, CallerContext caller);

    Task<bool> HasAnyUsersAsync();
    Task<Organization> CreateOrganizationAsync(string name, CallerContext caller);
    Task<List<Organization>> GetAllOrganizationsAsync(CallerContext caller);
    Task<Organization?> GetOrganizationByIdAsync(string id, CallerContext caller);
    Task UpdateOrganizationAsync(string id, string name, CallerContext caller);
    Task DeleteOrganizationAsync(string id, CallerContext caller);
    Task UpdateOrganizationLogoAsync(string id, string? logoSmall, CallerContext caller);
    Task<List<User>> GetUsersByOrganizationAsync(string organizationId, CallerContext caller);

    Task<string?> GetUserSettingAsync(string userId, string key, CallerContext caller);
    Task SetUserSettingAsync(string userId, string key, string value, CallerContext caller);
    Task DeleteUserSettingAsync(string userId, string key, CallerContext caller);
}

public class UserService(IDbContextFactory<PresentationContext> dbContextFactory) : IUserService
{
    public async Task<User?> GetByLoginAsync(string provider, string providerSubjectId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var login = await context.UserLogins
            .Include(ul => ul.User)
            .ThenInclude(u => u.Organization)
            .FirstOrDefaultAsync(ul => ul.Provider == provider && ul.ProviderSubjectId == providerSubjectId);
        return login?.User;
    }

    public async Task<UserLogin> LinkLoginAsync(string userId, string provider, string providerSubjectId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var existing = await context.UserLogins
            .FirstOrDefaultAsync(ul => ul.Provider == provider && ul.ProviderSubjectId == providerSubjectId);
        if (existing is not null)
            return existing;

        var login = new UserLogin
        {
            UserId = userId,
            Provider = provider,
            ProviderSubjectId = providerSubjectId
        };
        context.UserLogins.Add(login);
        await context.SaveChangesAsync();
        return login;
    }

    public async Task<Invite?> GetInviteByTokenAsync(string token)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Invites
            .Include(i => i.User)
            .ThenInclude(u => u.Organization)
            .FirstOrDefaultAsync(i => i.Token == token && !i.Used && i.ExpiresAt > DateTime.UtcNow);
    }

    public async Task<bool> IsInviteExpiredAsync(string token)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Invites
            .AnyAsync(i => i.Token == token && !i.Used && i.ExpiresAt <= DateTime.UtcNow);
    }

    public async Task MarkInviteUsedAsync(string inviteId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Invites
            .Where(i => i.Id == inviteId)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.Used, true));
    }

    public async Task<bool> IsEmailTakenAsync(string email, string? excludeUserId = null)
    {
        if (string.IsNullOrWhiteSpace(email)) return false;
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Users
            .AnyAsync(u => u.Email == email && (excludeUserId == null || u.Id != excludeUserId));
    }

    public async Task<List<User>> GetAllUsersAsync(CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Users
            .Include(u => u.Organization)
            .Include(u => u.Logins)
            .OrderBy(u => u.Name)
            .ToListAsync();
    }

    public async Task<User?> GetByIdAsync(string id, CallerContext caller)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await context.Users
            .Include(u => u.Organization)
            .Include(u => u.Logins)
            .FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return null;

        if (caller.Role != UserRole.SuperAdmin && user.OrganizationId != caller.OrganizationId)
            throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");

        return user;
    }

    public async Task<User> CreateUserAsync(string name, string email, string organizationId, UserRole role, CallerContext caller)
    {
        if (caller.Role != UserRole.SuperAdmin)
        {
            if (caller.OrganizationId != organizationId)
                throw new UnauthorizedAccessException("Access denied: cannot create users in another organization.");
            if (role == UserRole.SuperAdmin)
                throw new UnauthorizedAccessException("Access denied: only SuperAdmin can assign the SuperAdmin role.");
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = new User
        {
            Name = name,
            Email = email,
            OrganizationId = organizationId,
            Role = role
        };
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    public async Task<User> CreateSuperUserAsync(string name)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = new User
        {
            Name = name,
            Role = UserRole.SuperAdmin
        };
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    public async Task UpdateUserAsync(string id, string name, string email, UserRole role, CallerContext caller)
    {
        if (id == caller.UserId && role != caller.Role)
            throw new UnauthorizedAccessException("Access denied: cannot change your own role.");

        await using var context = await dbContextFactory.CreateDbContextAsync();

        if (caller.Role != UserRole.SuperAdmin)
        {
            var targetUser = await context.Users.FirstOrDefaultAsync(u => u.Id == id);
            if (targetUser is null)
                throw new InvalidOperationException("User not found.");
            if (targetUser.OrganizationId != caller.OrganizationId)
                throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");
            if (role == UserRole.SuperAdmin)
                throw new UnauthorizedAccessException("Access denied: only SuperAdmin can assign the SuperAdmin role.");
        }

        await context.Users
            .Where(u => u.Id == id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.Name, name)
                .SetProperty(u => u.Email, email)
                .SetProperty(u => u.Role, role));
    }

    public async Task UpdateEmailIfEmptyAsync(string id, string email)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Users
            .Where(u => u.Id == id && (u.Email == null || u.Email == ""))
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Email, email));
    }

    public async Task UpdateProfileImageAsync(string id, string? profileImage, string? profileImageSmall)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Users
            .Where(u => u.Id == id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.ProfileImage, profileImage)
                .SetProperty(u => u.ProfileImageSmall, profileImageSmall));
    }

    public async Task UpdateProfileImageAsync(string id, string? profileImage, string? profileImageSmall, CallerContext caller)
    {
        if (caller.Role != UserRole.SuperAdmin)
        {
            await using var checkContext = await dbContextFactory.CreateDbContextAsync();
            var targetUser = await checkContext.Users.FirstOrDefaultAsync(u => u.Id == id);
            if (targetUser is null)
                throw new InvalidOperationException("User not found.");
            if (targetUser.OrganizationId != caller.OrganizationId)
                throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");
        }

        await UpdateProfileImageAsync(id, profileImage, profileImageSmall);
    }

    public async Task DeleteUserAsync(string id, CallerContext caller)
    {
        if (id == caller.UserId)
            throw new InvalidOperationException("Cannot delete your own account.");

        await using var context = await dbContextFactory.CreateDbContextAsync();

        if (caller.Role != UserRole.SuperAdmin)
        {
            var targetUser = await context.Users.FirstOrDefaultAsync(u => u.Id == id);
            if (targetUser is null)
                throw new InvalidOperationException("User not found.");
            if (targetUser.OrganizationId != caller.OrganizationId)
                throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");
        }

        await context.Users
            .Where(u => u.Id == id)
            .ExecuteDeleteAsync();
    }

    public async Task<List<UserLogin>> GetLoginsForUserAsync(string userId, CallerContext caller)
    {
        await VerifyUserAccessAsync(userId, caller);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.UserLogins
            .Where(ul => ul.UserId == userId)
            .OrderBy(ul => ul.Provider)
            .ToListAsync();
    }

    public async Task DeleteLoginAsync(string loginId, CallerContext caller)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var login = await context.UserLogins.Include(ul => ul.User).FirstOrDefaultAsync(ul => ul.Id == loginId);
        if (login is null) return;
        if (caller.Role != UserRole.SuperAdmin && login.User.OrganizationId != caller.OrganizationId)
            throw new UnauthorizedAccessException("Access denied: login belongs to a user in a different organization.");
        await context.UserLogins.Where(ul => ul.Id == loginId).ExecuteDeleteAsync();
    }

    public async Task<List<Invite>> GetInvitesForUserAsync(string userId, CallerContext caller)
    {
        await VerifyUserAccessAsync(userId, caller);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Invites
            .Where(i => i.UserId == userId && !i.Used)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();
    }

    public async Task<Invite> CreateInviteAsync(string userId, CallerContext caller)
    {
        await VerifyUserAccessAsync(userId, caller);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var invite = new Invite { UserId = userId };
        context.Invites.Add(invite);
        await context.SaveChangesAsync();
        return invite;
    }

    public async Task DeleteInviteAsync(string inviteId, CallerContext caller)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var invite = await context.Invites.Include(i => i.User).FirstOrDefaultAsync(i => i.Id == inviteId);
        if (invite is null) return;
        if (caller.Role != UserRole.SuperAdmin && invite.User.OrganizationId != caller.OrganizationId)
            throw new UnauthorizedAccessException("Access denied: invite belongs to a user in a different organization.");
        await context.Invites.Where(i => i.Id == inviteId).ExecuteDeleteAsync();
    }

    private async Task VerifyUserAccessAsync(string userId, CallerContext caller)
    {
        if (caller.Role == UserRole.SuperAdmin) return;
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await context.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) throw new InvalidOperationException("User not found.");
        if (user.OrganizationId != caller.OrganizationId)
            throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");
    }

    public async Task<bool> HasAnyUsersAsync()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Users.AnyAsync();
    }

    public async Task<Organization> CreateOrganizationAsync(string name, CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var org = new Organization { Name = name };
        context.Organizations.Add(org);
        await context.SaveChangesAsync();
        return org;
    }

    public async Task<List<Organization>> GetAllOrganizationsAsync(CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Organizations
            .Include(o => o.Users)
            .OrderBy(o => o.Name)
            .ToListAsync();
    }

    public async Task<Organization?> GetOrganizationByIdAsync(string id, CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Organizations
            .Include(o => o.Users)
            .FirstOrDefaultAsync(o => o.Id == id);
    }

    public async Task UpdateOrganizationAsync(string id, string name, CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Organizations
            .Where(o => o.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Name, name));
    }

    public async Task DeleteOrganizationAsync(string id, CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await using var transaction = await context.Database.BeginTransactionAsync();

        await context.Users
            .Where(u => u.OrganizationId == id)
            .ExecuteDeleteAsync();

        await context.Organizations
            .Where(o => o.Id == id)
            .ExecuteDeleteAsync();

        await transaction.CommitAsync();
    }

    public async Task UpdateOrganizationLogoAsync(string id, string? logoSmall, CallerContext caller)
    {
        caller.RequireSuperAdmin();
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Organizations
            .Where(o => o.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.LogoSmall, logoSmall));
    }

    public async Task<List<User>> GetUsersByOrganizationAsync(string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Users
            .Include(u => u.Organization)
            .Include(u => u.Logins)
            .Where(u => u.OrganizationId == organizationId)
            .OrderBy(u => u.Name)
            .ToListAsync();
    }

    public async Task<string?> GetUserSettingAsync(string userId, string key, CallerContext caller)
    {
        caller.RequireUserAccess(userId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var setting = await context.UserSettings
            .FirstOrDefaultAsync(us => us.UserId == userId && us.Key == key);
        return setting?.Value;
    }

    public async Task SetUserSettingAsync(string userId, string key, string value, CallerContext caller)
    {
        caller.RequireUserAccess(userId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var setting = await context.UserSettings
            .FirstOrDefaultAsync(us => us.UserId == userId && us.Key == key);

        if (setting is not null)
        {
            setting.Value = value;
        }
        else
        {
            context.UserSettings.Add(new UserSetting
            {
                UserId = userId,
                Key = key,
                Value = value
            });
        }

        await context.SaveChangesAsync();
    }

    public async Task DeleteUserSettingAsync(string userId, string key, CallerContext caller)
    {
        caller.RequireUserAccess(userId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.UserSettings
            .Where(us => us.UserId == userId && us.Key == key)
            .ExecuteDeleteAsync();
    }
}
