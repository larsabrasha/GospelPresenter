using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IUserService
{
    Task<User?> GetByLoginAsync(string provider, string providerSubjectId);
    Task<UserLogin> LinkLoginAsync(string userId, string provider, string providerSubjectId);
    Task<Invite?> GetInviteByTokenAsync(string token);
    Task<bool> IsInviteExpiredAsync(string token);
    Task MarkInviteUsedAsync(string inviteId);

    Task<bool> IsEmailTakenAsync(string email, string? excludeUserId = null);
    Task<List<User>> GetAllUsersAsync();
    Task<User?> GetByIdAsync(string id);
    Task<User> CreateUserAsync(string name, string email, string organizationId, UserRole role);
    Task UpdateUserAsync(string id, string name, string email, UserRole role);
    Task UpdateEmailIfEmptyAsync(string id, string email);
    Task UpdateProfileImageAsync(string id, string? profileImage);
    Task DeleteUserAsync(string id);

    Task<List<UserLogin>> GetLoginsForUserAsync(string userId);
    Task DeleteLoginAsync(string loginId);

    Task<List<Invite>> GetInvitesForUserAsync(string userId);
    Task<Invite> CreateInviteAsync(string userId);
    Task DeleteInviteAsync(string inviteId);
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

    public async Task<List<User>> GetAllUsersAsync()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Users
            .Include(u => u.Organization)
            .Include(u => u.Logins)
            .OrderBy(u => u.Name)
            .ToListAsync();
    }

    public async Task<User?> GetByIdAsync(string id)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Users
            .Include(u => u.Organization)
            .Include(u => u.Logins)
            .FirstOrDefaultAsync(u => u.Id == id);
    }

    public async Task<User> CreateUserAsync(string name, string email, string organizationId, UserRole role)
    {
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

    public async Task UpdateUserAsync(string id, string name, string email, UserRole role)
    {
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

    public async Task UpdateProfileImageAsync(string id, string? profileImage)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Users
            .Where(u => u.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.ProfileImage, profileImage));
    }

    public async Task DeleteUserAsync(string id)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Users
            .Where(u => u.Id == id)
            .ExecuteDeleteAsync();
    }

    public async Task<List<UserLogin>> GetLoginsForUserAsync(string userId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.UserLogins
            .Where(ul => ul.UserId == userId)
            .OrderBy(ul => ul.Provider)
            .ToListAsync();
    }

    public async Task DeleteLoginAsync(string loginId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.UserLogins
            .Where(ul => ul.Id == loginId)
            .ExecuteDeleteAsync();
    }

    public async Task<List<Invite>> GetInvitesForUserAsync(string userId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Invites
            .Where(i => i.UserId == userId && !i.Used)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();
    }

    public async Task<Invite> CreateInviteAsync(string userId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var invite = new Invite { UserId = userId };
        context.Invites.Add(invite);
        await context.SaveChangesAsync();
        return invite;
    }

    public async Task DeleteInviteAsync(string inviteId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.Invites
            .Where(i => i.Id == inviteId)
            .ExecuteDeleteAsync();
    }
}
