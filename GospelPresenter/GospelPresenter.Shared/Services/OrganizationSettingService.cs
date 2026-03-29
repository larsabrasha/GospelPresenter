using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IOrganizationSettingService
{
    Task<string?> GetSettingAsync(string organizationId, string key, CallerContext caller);
    Task SetSettingAsync(string organizationId, string key, string value, CallerContext caller);
}

public class OrganizationSettingService(IDbContextFactory<PresentationContext> dbContextFactory) : IOrganizationSettingService
{
    public async Task<string?> GetSettingAsync(string organizationId, string key, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var setting = await context.OrganizationSettings
            .FirstOrDefaultAsync(os => os.OrganizationId == organizationId && os.Key == key);
        return setting?.Value;
    }

    public async Task SetSettingAsync(string organizationId, string key, string value, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageUsers);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var setting = await context.OrganizationSettings
            .FirstOrDefaultAsync(os => os.OrganizationId == organizationId && os.Key == key);

        if (setting is not null)
        {
            setting.Value = value;
        }
        else
        {
            context.OrganizationSettings.Add(new OrganizationSetting
            {
                OrganizationId = organizationId,
                Key = key,
                Value = value
            });
        }

        await context.SaveChangesAsync();
    }
}
