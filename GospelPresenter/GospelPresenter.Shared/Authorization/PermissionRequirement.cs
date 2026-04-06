using Microsoft.AspNetCore.Authorization;

namespace GospelPresenter.Shared.Authorization;

public class PermissionRequirement(Models.Permission permission) : IAuthorizationRequirement
{
    public Models.Permission Permission { get; } = permission;
}
