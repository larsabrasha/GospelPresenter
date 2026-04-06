using System.Security.Claims;
using GospelPresenter.Shared.Models;
using Microsoft.AspNetCore.Authorization;

namespace GospelPresenter.Shared.Authorization;

public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        var roleClaim = context.User.FindFirst(ClaimTypes.Role)?.Value;
        if (roleClaim is not null && Enum.TryParse<UserRole>(roleClaim, out var role))
        {
            if (PermissionMap.HasPermission(role, requirement.Permission))
            {
                context.Succeed(requirement);
            }
        }

        return Task.CompletedTask;
    }
}
