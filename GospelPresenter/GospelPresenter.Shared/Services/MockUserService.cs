using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.Services;

public class MockUserService : IUserService
{
    private static readonly Organization defaultOrg = new() { Id = "mock-org", Name = "Mock" };

    private static readonly User mockUser = new()
    {
        Id = "mock-user",
        Name = "Mock User",
        Email = "mock@example.com",
        Role = UserRole.Admin,
        OrganizationId = defaultOrg.Id,
        Organization = defaultOrg
    };

    public Task<User?> GetByLoginAsync(string provider, string providerSubjectId)
        => Task.FromResult<User?>(mockUser);

    public Task<UserLogin> LinkLoginAsync(string userId, string provider, string providerSubjectId)
        => Task.FromResult(new UserLogin { UserId = userId, Provider = provider, ProviderSubjectId = providerSubjectId });

    public Task<Invite?> GetInviteByTokenAsync(string token)
        => Task.FromResult<Invite?>(null);

    public Task<bool> IsInviteExpiredAsync(string token)
        => Task.FromResult(false);

    public Task MarkInviteUsedAsync(string inviteId)
        => Task.CompletedTask;

    public Task<bool> IsEmailTakenAsync(string email, string? excludeUserId = null)
        => Task.FromResult(false);

    public Task<List<User>> GetAllUsersAsync()
        => Task.FromResult(new List<User> { mockUser });

    public Task<User?> GetByIdAsync(string id)
        => Task.FromResult<User?>(mockUser);

    public Task<User> CreateUserAsync(string name, string email, string organizationId, UserRole role)
        => Task.FromResult(new User { Name = name, Email = email, OrganizationId = organizationId, Role = role, Organization = defaultOrg });

    public Task<User> CreateSuperUserAsync(string name)
        => Task.FromResult(new User { Name = name, Role = UserRole.SuperAdmin });

    public Task UpdateUserAsync(string id, string name, string email, UserRole role)
        => Task.CompletedTask;

    public Task UpdateEmailIfEmptyAsync(string id, string email)
        => Task.CompletedTask;

    public Task UpdateProfileImageAsync(string id, string? profileImage, string? profileImageSmall)
        => Task.CompletedTask;

    public Task DeleteUserAsync(string id)
        => Task.CompletedTask;

    public Task<List<UserLogin>> GetLoginsForUserAsync(string userId)
        => Task.FromResult(new List<UserLogin>());

    public Task DeleteLoginAsync(string loginId)
        => Task.CompletedTask;

    public Task<List<Invite>> GetInvitesForUserAsync(string userId)
        => Task.FromResult(new List<Invite>());

    public Task<Invite> CreateInviteAsync(string userId)
        => Task.FromResult(new Invite { UserId = userId });

    public Task DeleteInviteAsync(string inviteId)
        => Task.CompletedTask;

    public Task<bool> HasAnyUsersAsync()
        => Task.FromResult(true);

    public Task<Organization> CreateOrganizationAsync(string name)
        => Task.FromResult(new Organization { Name = name });

    public Task<List<Organization>> GetAllOrganizationsAsync()
        => Task.FromResult(new List<Organization> { defaultOrg });

    public Task<Organization?> GetOrganizationByIdAsync(string id)
        => Task.FromResult<Organization?>(defaultOrg);

    public Task UpdateOrganizationAsync(string id, string name)
        => Task.CompletedTask;

    public Task DeleteOrganizationAsync(string id)
        => Task.CompletedTask;

    public Task<List<User>> GetUsersByOrganizationAsync(string organizationId)
        => Task.FromResult(new List<User> { mockUser });
}
