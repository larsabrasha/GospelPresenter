using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.State;

public class ActiveOrganizationState
{
    public string? UserId { get; private set; }
    public UserRole UserRole { get; private set; }
    public string? UserOrganizationId { get; private set; }
    public string? SelectedOrganizationId { get; private set; }
    public string? SelectedOrganizationName { get; private set; }

    public bool IsSuperAdmin => UserRole == UserRole.SuperAdmin;

    public string? ActiveOrganizationId => IsSuperAdmin ? SelectedOrganizationId : UserOrganizationId;

    public bool HasActiveOrganization => ActiveOrganizationId is not null;

    public event Action? OnChange;

    public void Initialize(string userId, UserRole role, string? organizationId)
    {
        UserId = userId;
        UserRole = role;
        UserOrganizationId = organizationId;
    }

    public void SwitchOrganization(string organizationId, string organizationName)
    {
        SelectedOrganizationId = organizationId;
        SelectedOrganizationName = organizationName;
        OnChange?.Invoke();
    }

    public void ClearOrganization()
    {
        SelectedOrganizationId = null;
        SelectedOrganizationName = null;
        OnChange?.Invoke();
    }
}
