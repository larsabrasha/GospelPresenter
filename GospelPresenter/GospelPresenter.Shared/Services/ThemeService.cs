using System.Collections.Concurrent;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IThemeService
{
    /// <summary>The themes an organisation can choose from: the built-in ones plus its own.</summary>
    Task<List<Theme>> GetThemesAsync(string organizationId, CallerContext caller);

    /// <summary>
    /// Resolves the theme a presentation is displayed with: its own theme if it has one, otherwise
    /// the organisation's default, otherwise Classic.
    /// </summary>
    Task<SlideTheme> GetForPresentationAsync(string organizationId, string? presentationThemeId, CallerContext caller);

    /// <summary>
    /// The organisation's default theme, for the views that render slides outside any presentation.
    /// </summary>
    Task<SlideTheme> GetOrganizationDefaultAsync(string organizationId, CallerContext caller);

    /// <summary>Which theme the organisation has chosen as its default, or null if it has never chosen.</summary>
    Task<string?> GetOrganizationDefaultIdAsync(string organizationId, CallerContext caller);

    /// <summary>
    /// Points the organisation at a default theme. Retroactive by design: presentations that never chose
    /// a theme of their own follow this one, including ones created before the change.
    /// </summary>
    Task SetOrganizationDefaultAsync(string organizationId, string themeId, CallerContext caller);
}

public class ThemeService(IDbContextFactory<PresentationContext> dbContextFactory) : IThemeService
{
    // Built-in definitions only. They are immutable for the lifetime of the process — the seeder runs
    // at startup, before any request — so they can be cached without invalidation. Organisation-owned
    // themes are deliberately not cached: they will be editable, and a stale cache would show the
    // operator something different from what they just saved.
    private readonly ConcurrentDictionary<string, SlideTheme> builtInCache = new();

    public async Task<List<Theme>> GetThemesAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewThemes);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.Themes
            .Where(t => t.OrganizationId == null || t.OrganizationId == organizationId)
            .OrderBy(t => t.OrganizationId == null ? 0 : 1)
            .ThenBy(t => t.SortOrder)
            .ThenBy(t => t.Name)
            .ToListAsync();
    }

    public async Task<SlideTheme> GetForPresentationAsync(
        string organizationId, string? presentationThemeId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewThemes);
        caller.RequireOrganizationAccess(organizationId);

        return presentationThemeId is not null
            ? await ResolveAsync(organizationId, presentationThemeId)
            : await ResolveDefaultAsync(organizationId);
    }

    public async Task<SlideTheme> GetOrganizationDefaultAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewThemes);
        caller.RequireOrganizationAccess(organizationId);

        return await ResolveDefaultAsync(organizationId);
    }

    public async Task<string?> GetOrganizationDefaultIdAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewThemes);
        caller.RequireOrganizationAccess(organizationId);

        return await ReadDefaultIdAsync(organizationId);
    }

    public async Task SetOrganizationDefaultAsync(string organizationId, string themeId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageThemes);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        // Only a theme the organisation may actually use: the id comes from the client, so without this a
        // caller could point their organisation at another organisation's theme.
        var exists = await context.Themes
            .AnyAsync(t => t.Id == themeId && (t.OrganizationId == null || t.OrganizationId == organizationId));
        if (!exists)
            throw new InvalidOperationException("Theme not found.");

        var setting = await context.OrganizationSettings
            .FirstOrDefaultAsync(os => os.OrganizationId == organizationId
                                    && os.Key == OrganizationSetting.DefaultThemeId);

        if (setting is not null)
        {
            setting.Value = themeId;
        }
        else
        {
            await ValidationHelper.RequireMaxCountAsync(
                context.OrganizationSettings.Where(os => os.OrganizationId == organizationId),
                AppConstraints.MaxSettingsPerOrg, "settings");

            context.OrganizationSettings.Add(new OrganizationSetting
            {
                OrganizationId = organizationId,
                Key = OrganizationSetting.DefaultThemeId,
                Value = themeId
            });
        }

        await context.SaveChangesAsync();
    }

    private async Task<SlideTheme> ResolveDefaultAsync(string organizationId) =>
        await ResolveAsync(organizationId, await ReadDefaultIdAsync(organizationId));

    private async Task<string?> ReadDefaultIdAsync(string organizationId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.OrganizationSettings
            .Where(os => os.OrganizationId == organizationId && os.Key == OrganizationSetting.DefaultThemeId)
            .Select(os => os.Value)
            .FirstOrDefaultAsync();
    }

    private async Task<SlideTheme> ResolveAsync(string organizationId, string? themeId)
    {
        // Never "the first row in the table": that would make the look depend on seeding order.
        themeId = string.IsNullOrEmpty(themeId) ? BuiltInThemes.ClassicId : themeId;

        if (builtInCache.TryGetValue(themeId, out var cached))
            return cached;

        await using var context = await dbContextFactory.CreateDbContextAsync();
        var theme = await context.Themes
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == themeId
                                   && (t.OrganizationId == null || t.OrganizationId == organizationId));

        if (theme is null)
        {
            // A presentation pointing at a theme that was deleted, or a database seeded before this
            // theme existed. Classic rather than an exception: a service is running.
            return themeId == BuiltInThemes.ClassicId
                ? SlideTheme.Fallback
                : await ResolveAsync(organizationId, BuiltInThemes.ClassicId);
        }

        if (theme.IsBuiltIn)
            builtInCache[theme.Id] = theme.Definition;

        return theme.Definition;
    }
}
