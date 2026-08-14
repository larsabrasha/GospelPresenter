using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Covers the resolution chain a slide's appearance depends on: the presentation's own theme, then the
/// organisation's default, then Classic. Getting this wrong does not throw — it silently shows the
/// wrong theme during a service — so each step is asserted separately.
/// </summary>
public class ThemeServiceTests : IDisposable
{
    private const string OrgId = "org-a";
    private const string OtherOrgId = "org-b";
    private const string OrgThemeId = "org-theme";
    private const string OtherOrgThemeId = "other-org-theme";
    private const string DeletedThemeId = "no-such-theme";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly ThemeService service;
    private readonly CallerContext caller = new("user-a", UserRole.Admin, OrgId);

    // Distinguishable from Classic by one property, so an assertion cannot pass by coincidence.
    private static readonly SlideTheme OrgDefinition = new()
    {
        Song = new SlideStyle { MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Oswald } }
    };

    private static readonly SlideTheme OtherOrgDefinition = new()
    {
        Song = new SlideStyle { MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Merriweather } }
    };

    public ThemeServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        service = new ThemeService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();
        context.Organizations.AddRange(
            new Organization { Id = OrgId, Name = "Org A" },
            new Organization { Id = OtherOrgId, Name = "Org B" });
        context.Themes.AddRange(
            new Theme { Id = OrgThemeId, OrganizationId = OrgId, Name = "Ours", Definition = OrgDefinition },
            new Theme { Id = OtherOrgThemeId, OrganizationId = OtherOrgId, Name = "Theirs", Definition = OtherOrgDefinition });
        context.SaveChanges();

        BuiltInThemeSeeder.SeedAsync(context).GetAwaiter().GetResult();
    }

    [Fact]
    public async Task GetForPresentationAsync_WithPresentationTheme_UsesThatTheme()
    {
        var theme = await service.GetForPresentationAsync(OrgId, OrgThemeId, caller);

        theme.Song.MainText.FontFamily.ShouldBe(SlideFontFamilies.Oswald);
    }

    [Fact]
    public async Task GetForPresentationAsync_WithoutPresentationTheme_UsesOrganizationDefault()
    {
        await SetDefaultThemeAsync(OrgThemeId);

        var theme = await service.GetForPresentationAsync(OrgId, presentationThemeId: null, caller);

        theme.Song.MainText.FontFamily.ShouldBe(SlideFontFamilies.Oswald);
    }

    [Fact]
    public async Task GetForPresentationAsync_WithNoThemeAnywhere_UsesClassic()
    {
        var theme = await service.GetForPresentationAsync(OrgId, presentationThemeId: null, caller);

        theme.ShouldBe(SlideTheme.Classic);
    }

    [Fact]
    public async Task GetForPresentationAsync_WithDeletedTheme_FallsBackToClassic()
    {
        var theme = await service.GetForPresentationAsync(OrgId, DeletedThemeId, caller);

        theme.ShouldBe(SlideTheme.Classic);
    }

    /// <summary>
    /// The presentation and the theme are both addressed by id, so a caller could name another
    /// organisation's theme and have its look applied to their own slides.
    /// </summary>
    [Fact]
    public async Task GetForPresentationAsync_WithAnotherOrganizationsTheme_FallsBackToClassic()
    {
        var theme = await service.GetForPresentationAsync(OrgId, OtherOrgThemeId, caller);

        theme.ShouldBe(SlideTheme.Classic);
    }

    [Fact]
    public async Task GetForPresentationAsync_ForAnotherOrganization_IsDenied()
    {
        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.GetForPresentationAsync(OtherOrgId, null, caller));
    }

    [Fact]
    public async Task GetForPresentationAsync_WithoutViewThemesPermission_IsDenied()
    {
        var noPermission = new CallerContext("user-a", (UserRole)999, OrgId);

        await Should.ThrowAsync<UnauthorizedAccessException>(
            () => service.GetForPresentationAsync(OrgId, null, noPermission));
    }

    [Fact]
    public async Task GetThemesAsync_ReturnsBuiltInAndOwnThemesOnly()
    {
        var themes = await service.GetThemesAsync(OrgId, caller);

        // Built-in themes first in their shipped order, then the organisation's own.
        themes.Select(t => t.Id).ShouldBe([..BuiltInThemes.All.Select(t => t.Id), OrgThemeId]);
    }

    [Fact]
    public async Task GetOrganizationDefaultAsync_FollowsTheSetting()
    {
        await SetDefaultThemeAsync(OrgThemeId);

        var theme = await service.GetOrganizationDefaultAsync(OrgId, caller);

        theme.Song.MainText.FontFamily.ShouldBe(SlideFontFamilies.Oswald);
    }

    /// <summary>
    /// Organisation themes will be editable, so they must not be served from the built-in cache.
    /// </summary>
    [Fact]
    public async Task GetForPresentationAsync_AfterAnOrganizationThemeChanges_ReturnsTheNewDefinition()
    {
        await service.GetForPresentationAsync(OrgId, OrgThemeId, caller);

        await using (var context = factory.CreateDbContext())
        {
            var theme = await context.Themes.FirstAsync(t => t.Id == OrgThemeId);
            theme.Definition = new SlideTheme
            {
                Song = new SlideStyle { MainText = new SlideTextStyle { FontFamily = SlideFontFamilies.Lato } }
            };
            await context.SaveChangesAsync();
        }

        var reloaded = await service.GetForPresentationAsync(OrgId, OrgThemeId, caller);

        reloaded.Song.MainText.FontFamily.ShouldBe(SlideFontFamilies.Lato);
    }

    private async Task SetDefaultThemeAsync(string themeId)
    {
        await using var context = factory.CreateDbContext();
        context.OrganizationSettings.Add(new OrganizationSetting
        {
            OrganizationId = OrgId,
            Key = OrganizationSetting.DefaultThemeId,
            Value = themeId
        });
        await context.SaveChangesAsync();
    }

    public void Dispose() => connection.Dispose();

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
