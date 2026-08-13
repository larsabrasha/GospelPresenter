using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public record CallerContext(string UserId, UserRole Role, string? OrganizationId)
{
    public bool HasPermission(Permission permission) => PermissionMap.HasPermission(Role, permission);

    public void RequirePermission(Permission permission)
    {
        if (!HasPermission(permission))
            throw new UnauthorizedAccessException($"Access denied: missing required permission {permission}.");
    }

    public void RequireOrganizationAccess(string organizationId)
    {
        if (!HasPermission(Permission.CrossOrganizationAccess) && OrganizationId != organizationId)
            throw new UnauthorizedAccessException("Access denied: you do not have access to this organization.");
    }

    public void RequireUserAccess(string targetUserId)
    {
        if (!HasPermission(Permission.CrossOrganizationAccess) && UserId != targetUserId)
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

    Task<List<McpApiKey>> GetMcpApiKeysAsync(string organizationId, CallerContext caller);
    Task<(McpApiKey ApiKey, string PlaintextKey)> CreateMcpApiKeyAsync(string name, string userId, string organizationId, CallerContext caller);
    Task DeleteMcpApiKeyAsync(string id, CallerContext caller);

    Task<List<CalendarSubscription>> GetCalendarSubscriptionsAsync(string userId, string organizationId, CallerContext caller);
    Task<(CalendarSubscription Subscription, string PlaintextToken)> CreateCalendarSubscriptionAsync(string name, string userId, string organizationId, CallerContext caller);
    Task DeleteCalendarSubscriptionAsync(string id, CallerContext caller);
    Task<CalendarSubscription?> FindCalendarSubscriptionByTokenAsync(string token);
    Task TouchCalendarSubscriptionAsync(string id);
}

public class UserService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    ISongPartLabelService songPartLabelService) : IUserService
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

        await ValidationHelper.RequireMaxCountAsync(
            context.UserLogins.Where(ul => ul.UserId == userId),
            AppConstraints.MaxLoginsPerUser, "logins");

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
        caller.RequirePermission(Permission.ManageOrganizations);
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

        if (!caller.HasPermission(Permission.CrossOrganizationAccess) && user.OrganizationId != caller.OrganizationId)
            throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");

        return user;
    }

    public async Task<User> CreateUserAsync(string name, string email, string organizationId, UserRole role, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageUsers);
        if (!caller.HasPermission(Permission.CrossOrganizationAccess) && caller.OrganizationId != organizationId)
            throw new UnauthorizedAccessException("Access denied: cannot create users in another organization.");
        if (!caller.HasPermission(Permission.AssignSuperAdminRole) && role == UserRole.SuperAdmin)
            throw new UnauthorizedAccessException("Access denied: you do not have permission to assign the SuperAdmin role.");
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(email, AppConstraints.EmailMaxLength, "Email");

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await ValidationHelper.RequireMaxCountAsync(
            context.Users.Where(u => u.OrganizationId == organizationId),
            AppConstraints.MaxUsersPerOrg, "users");
        var user = new User
        {
            Name = name,
            Email = email,
            OrganizationId = organizationId,
            Role = role
        };
        context.Users.Add(user);
        var invite = new Invite { UserId = user.Id };
        context.Invites.Add(invite);
        await context.SaveChangesAsync();
        return user;
    }

    public async Task<User> CreateSuperUserAsync(string name)
    {
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
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
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(email, AppConstraints.EmailMaxLength, "Email");
        if (id != caller.UserId)
        {
            caller.RequirePermission(Permission.ManageUsers);

            await using var checkContext = await dbContextFactory.CreateDbContextAsync();

            if (!caller.HasPermission(Permission.CrossOrganizationAccess))
            {
                var targetUser = await checkContext.Users.FirstOrDefaultAsync(u => u.Id == id);
                if (targetUser is null)
                    throw new InvalidOperationException("User not found.");
                if (targetUser.OrganizationId != caller.OrganizationId)
                    throw new UnauthorizedAccessException("Access denied: user belongs to a different organization.");
            }
            if (!caller.HasPermission(Permission.AssignSuperAdminRole) && role == UserRole.SuperAdmin)
                throw new UnauthorizedAccessException("Access denied: you do not have permission to assign the SuperAdmin role.");
        }
        else if (role != caller.Role)
        {
            throw new UnauthorizedAccessException("Access denied: cannot change your own role.");
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();
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
        var removed = profileImage is null;
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Users
            .Where(u => u.Id == id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.ProfileImage, profileImage)
                .SetProperty(u => u.ProfileImageSmall, profileImageSmall)
                .SetProperty(u => u.ProfileImageRemoved, removed));
    }

    public async Task UpdateProfileImageAsync(string id, string? profileImage, string? profileImageSmall, CallerContext caller)
    {
        if (!caller.HasPermission(Permission.CrossOrganizationAccess))
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
        caller.RequirePermission(Permission.ManageUsers);
        if (id == caller.UserId)
            throw new InvalidOperationException("Cannot delete your own account.");

        await using var context = await dbContextFactory.CreateDbContextAsync();

        if (!caller.HasPermission(Permission.CrossOrganizationAccess))
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
        if (!caller.HasPermission(Permission.CrossOrganizationAccess) && login.User.OrganizationId != caller.OrganizationId)
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
        await ValidationHelper.RequireMaxCountAsync(
            context.Invites.Where(i => i.UserId == userId && !i.Used),
            AppConstraints.MaxInvitesPerUser, "invites");
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
        if (!caller.HasPermission(Permission.CrossOrganizationAccess) && invite.User.OrganizationId != caller.OrganizationId)
            throw new UnauthorizedAccessException("Access denied: invite belongs to a user in a different organization.");
        await context.Invites.Where(i => i.Id == inviteId).ExecuteDeleteAsync();
    }

    private async Task VerifyUserAccessAsync(string userId, CallerContext caller)
    {
        if (caller.HasPermission(Permission.CrossOrganizationAccess)) return;
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
        caller.RequirePermission(Permission.ManageOrganizations);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await ValidationHelper.RequireMaxCountAsync(
            context.Organizations, AppConstraints.MaxOrganizationsTotal, "organizations");
        var org = new Organization { Name = name };
        context.Organizations.Add(org);
        await context.SaveChangesAsync();
        await songPartLabelService.CreateDefaultLabelsAsync(org.Id);
        return org;
    }

    public async Task<List<Organization>> GetAllOrganizationsAsync(CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageOrganizations);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Organizations
            .Include(o => o.Users)
            .OrderBy(o => o.Name)
            .ToListAsync();
    }

    public async Task<Organization?> GetOrganizationByIdAsync(string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageOrganizations);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Organizations
            .Include(o => o.Users)
            .FirstOrDefaultAsync(o => o.Id == id);
    }

    public async Task UpdateOrganizationAsync(string id, string name, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageOrganizations);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Organizations
            .Where(o => o.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Name, name));
    }

    public async Task DeleteOrganizationAsync(string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageOrganizations);
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
        caller.RequirePermission(Permission.ManageOrganizations);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Organizations
            .Where(o => o.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.LogoSmall, logoSmall));
    }

    public async Task<List<User>> GetUsersByOrganizationAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewUsers);
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
        ValidationHelper.RequireMaxLength(key, AppConstraints.SettingsKeyMaxLength, "Key");
        ValidationHelper.RequireMaxLength(value, AppConstraints.SettingsValueMaxLength, "Value");
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var setting = await context.UserSettings
            .FirstOrDefaultAsync(us => us.UserId == userId && us.Key == key);

        if (setting is not null)
        {
            setting.Value = value;
        }
        else
        {
            if (!await context.Users.AnyAsync(u => u.Id == userId))
                return;

            await ValidationHelper.RequireMaxCountAsync(
                context.UserSettings.Where(us => us.UserId == userId),
                AppConstraints.MaxSettingsPerUser, "settings");
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

    public async Task<List<McpApiKey>> GetMcpApiKeysAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageMcpApiKeys);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.McpApiKeys
            .Include(k => k.User)
            .Where(k => k.OrganizationId == organizationId)
            .OrderByDescending(k => k.CreatedAt)
            .ToListAsync();
    }

    public async Task<(McpApiKey ApiKey, string PlaintextKey)> CreateMcpApiKeyAsync(string name, string userId, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageMcpApiKeys);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync();

        // The key authenticates as this user in this organization, so the two have to belong
        // together. RequireOrganizationAccess only proves the caller owns organizationId -- it
        // says nothing about the user the key is minted for, and the user list is filtered in the
        // UI only. Without this, a key could be issued against a user from another organization,
        // and everything done with it would be recorded as that user.
        var userInOrganization = await context.Users
            .AnyAsync(u => u.Id == userId && u.OrganizationId == organizationId);
        if (!userInOrganization) throw new InvalidOperationException("User not found.");

        await ValidationHelper.RequireMaxCountAsync(
            context.McpApiKeys.Where(k => k.UserId == userId),
            AppConstraints.MaxApiKeysPerUser, "API keys");
        var plaintextKey = McpApiKey.GenerateKey();
        var apiKey = new McpApiKey
        {
            Name = name,
            UserId = userId,
            OrganizationId = organizationId,
            KeyHash = McpApiKey.HashKey(plaintextKey)
        };
        context.McpApiKeys.Add(apiKey);
        await context.SaveChangesAsync();
        return (apiKey, plaintextKey);
    }

    public async Task DeleteMcpApiKeyAsync(string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageMcpApiKeys);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var key = await context.McpApiKeys.FirstOrDefaultAsync(k => k.Id == id);
        if (key is null) return;
        caller.RequireOrganizationAccess(key.OrganizationId);
        await context.McpApiKeys.Where(k => k.Id == id).ExecuteDeleteAsync();
    }

    public async Task<List<CalendarSubscription>> GetCalendarSubscriptionsAsync(string userId, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        caller.RequireUserAccess(userId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.CalendarSubscriptions
            .Where(s => s.UserId == userId && s.OrganizationId == organizationId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    public async Task<(CalendarSubscription Subscription, string PlaintextToken)> CreateCalendarSubscriptionAsync(string name, string userId, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        caller.RequireUserAccess(userId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await ValidationHelper.RequireMaxCountAsync(
            context.CalendarSubscriptions.Where(s => s.UserId == userId),
            AppConstraints.MaxCalendarSubscriptionsPerUser, "Calendar subscriptions");
        var plaintext = CalendarSubscription.GenerateToken();
        var subscription = new CalendarSubscription
        {
            Name = name,
            UserId = userId,
            OrganizationId = organizationId,
            TokenHash = CalendarSubscription.HashToken(plaintext)
        };
        context.CalendarSubscriptions.Add(subscription);
        await context.SaveChangesAsync();
        return (subscription, plaintext);
    }

    public async Task DeleteCalendarSubscriptionAsync(string id, CallerContext caller)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var subscription = await context.CalendarSubscriptions.FirstOrDefaultAsync(s => s.Id == id);
        if (subscription is null) return;
        caller.RequireOrganizationAccess(subscription.OrganizationId);
        caller.RequireUserAccess(subscription.UserId);
        await context.CalendarSubscriptions.Where(s => s.Id == id).ExecuteDeleteAsync();
    }

    public async Task<CalendarSubscription?> FindCalendarSubscriptionByTokenAsync(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var hash = CalendarSubscription.HashToken(token);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.CalendarSubscriptions
            .Include(s => s.Organization)
            .FirstOrDefaultAsync(s => s.TokenHash == hash);
    }

    public async Task TouchCalendarSubscriptionAsync(string id)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.CalendarSubscriptions
            .Where(s => s.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.LastAccessedAt, DateTime.UtcNow));
    }
}
