using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Shared.State;

public class ActiveOrganizationState
{
    public string? UserId { get; private set; }
    public UserRole UserRole { get; private set; }
    public string? UserOrganizationId { get; private set; }
    public string? SelectedOrganizationId { get; private set; }
    public string? SelectedOrganizationName { get; private set; }

    public bool IsSuperAdmin => UserRole == UserRole.SuperAdmin;

    public bool HasPermission(Permission permission) => PermissionMap.HasPermission(UserRole, permission);

    public string? ActiveOrganizationId => IsSuperAdmin ? SelectedOrganizationId : UserOrganizationId;

public bool IsInitialized { get; private set; }

    public CallerContext ToCallerContext() => new(UserId!, UserRole, ActiveOrganizationId);

    public event Action? OnChange;
    public event Action? OnOrganizationsChanged;

    public void Initialize(string userId, UserRole role, string? organizationId)
    {
        UserId = userId;
        UserRole = role;
        UserOrganizationId = organizationId;
    }

    public void MarkInitialized()
    {
        IsInitialized = true;
        OnChange?.Invoke();
    }

    public void SwitchOrganization(string organizationId, string organizationName)
    {
        SelectedOrganizationId = organizationId;
        SelectedOrganizationName = organizationName;
        OnChange?.Invoke();
    }

    public void NotifyOrganizationsChanged()
    {
        OnOrganizationsChanged?.Invoke();
    }

}
