using GospelPresenter.Shared.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;

namespace GospelPresenter.Shared.Authorization;

public static class PermissionPolicies
{
    public const string ViewPresentations = "Permission:ViewPresentations";
    public const string ManagePresentations = "Permission:ManagePresentations";
    public const string ViewSongs = "Permission:ViewSongs";
    public const string ManageSongs = "Permission:ManageSongs";
    public const string ViewOverlays = "Permission:ViewOverlays";
    public const string ManageOverlays = "Permission:ManageOverlays";
    public const string ViewOrganizationImages = "Permission:ViewOrganizationImages";
    public const string ManageOrganizationImages = "Permission:ManageOrganizationImages";
    public const string ViewUsers = "Permission:ViewUsers";
    public const string ManageUsers = "Permission:ManageUsers";
    public const string ViewTemplates = "Permission:ViewTemplates";
    public const string ManageTemplates = "Permission:ManageTemplates";
    public const string ViewOrganizationAudios = "Permission:ViewOrganizationAudios";
    public const string ManageOrganizationAudios = "Permission:ManageOrganizationAudios";
    public const string ViewCcliReport = "Permission:ViewCcliReport";
    public const string ManageCcliReport = "Permission:ManageCcliReport";
    public const string ManageOrganizations = "Permission:ManageOrganizations";
    public const string AssignSuperAdminRole = "Permission:AssignSuperAdminRole";
    public const string CrossOrganizationAccess = "Permission:CrossOrganizationAccess";
    public const string ManageMcpApiKeys = "Permission:ManageMcpApiKeys";

    public static string PolicyName(Permission permission) => $"Permission:{permission}";

    public static IServiceCollection AddPermissionAuthorization(this IServiceCollection services)
    {
        services.AddAuthorizationCore(options =>
        {
            foreach (var permission in Enum.GetValues<Permission>())
            {
                options.AddPolicy(PolicyName(permission), policy =>
                    policy.Requirements.Add(new PermissionRequirement(permission)));
            }
        });

        services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();

        return services;
    }
}
