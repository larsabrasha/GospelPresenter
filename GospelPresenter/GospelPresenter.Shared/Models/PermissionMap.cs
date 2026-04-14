namespace GospelPresenter.Shared.Models;

public static class PermissionMap
{
    private static readonly Dictionary<UserRole, HashSet<Permission>> rolePermissions = new()
    {
        [UserRole.User] =
        [
            Permission.ViewPresentations,
            Permission.ManagePresentations,
            Permission.ViewOrganizationImages,
            Permission.ManageOrganizationImages,
            Permission.ViewOrganizationAudios,
            Permission.ManageOrganizationAudios,
            Permission.ViewSongs,
            Permission.ManageSongs,
            Permission.ViewOverlays,
            Permission.ManageOverlays,
            Permission.ViewTemplates,
            Permission.ViewBibles,
            Permission.ManageBibles
        ],
        [UserRole.Admin] =
        [
            Permission.ViewPresentations,
            Permission.ManagePresentations,
            Permission.ViewOrganizationImages,
            Permission.ManageOrganizationImages,
            Permission.ViewOrganizationAudios,
            Permission.ManageOrganizationAudios,
            Permission.ViewSongs,
            Permission.ManageSongs,
            Permission.ViewOverlays,
            Permission.ManageOverlays,
            Permission.ViewTemplates,
            Permission.ManageTemplates,
            Permission.ViewUsers,
            Permission.ManageUsers,
            Permission.ViewCcliReport,
            Permission.ManageCcliReport,
            Permission.ManageRemoteDisplays,
            Permission.ViewBibles,
            Permission.ManageBibles
        ],
        [UserRole.SuperAdmin] = [..Enum.GetValues<Permission>()]
    };

    public static HashSet<Permission> GetPermissions(UserRole role)
    {
        return rolePermissions.TryGetValue(role, out var permissions)
            ? permissions
            : new HashSet<Permission>();
    }

    public static bool HasPermission(UserRole role, Permission permission)
    {
        return GetPermissions(role).Contains(permission);
    }
}
