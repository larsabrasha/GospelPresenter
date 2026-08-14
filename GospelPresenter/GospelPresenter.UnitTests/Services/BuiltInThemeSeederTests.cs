using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The seeder runs on every deploy and on every start of a mock database, so being idempotent is not a
/// nice-to-have: a duplicate or a wiped row would change what presentations point at.
/// </summary>
public class BuiltInThemeSeederTests : IDisposable
{
    private const string RetiredThemeId = "retired";

    private readonly SqliteConnection connection;
    private readonly DbContextOptions<PresentationContext> options;

    public BuiltInThemeSeederTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;

        using var context = new PresentationContext(options);
        context.Database.EnsureCreated();
    }

    [Fact]
    public async Task SeedAsync_CreatesEveryBuiltInTheme()
    {
        await using var context = new PresentationContext(options);

        await BuiltInThemeSeeder.SeedAsync(context);

        var ids = await context.Themes.Select(t => t.Id).ToListAsync();
        ids.ShouldBe(BuiltInThemes.All.Select(t => t.Id).ToList(), ignoreOrder: true);
    }

    [Fact]
    public async Task SeedAsync_RunTwice_DoesNotDuplicateThemes()
    {
        await using var context = new PresentationContext(options);

        await BuiltInThemeSeeder.SeedAsync(context);
        await BuiltInThemeSeeder.SeedAsync(context);

        var count = await context.Themes.CountAsync();
        count.ShouldBe(BuiltInThemes.All.Count);
    }

    /// <summary>Built-in themes are live: what the code says wins over what is stored.</summary>
    [Fact]
    public async Task SeedAsync_OverwritesAnEditedBuiltInDefinition()
    {
        await using (var context = new PresentationContext(options))
        {
            await BuiltInThemeSeeder.SeedAsync(context);
            var classic = await context.Themes.FirstAsync(t => t.Id == BuiltInThemes.ClassicId);
            classic.Definition = new SlideTheme
            {
                Song = new SlideStyle { MainText = new SlideTextStyle { FontSize = 12 } }
            };
            await context.SaveChangesAsync();
        }

        await using (var context = new PresentationContext(options))
        {
            await BuiltInThemeSeeder.SeedAsync(context);
        }

        await using var verify = new PresentationContext(options);
        var reseeded = await verify.Themes.FirstAsync(t => t.Id == BuiltInThemes.ClassicId);
        reseeded.Definition.ShouldBe(SlideTheme.Classic);
    }

    /// <summary>
    /// A theme that has been removed from the code is left in place: presentations may still point at
    /// it, and deleting it would silently change how they look.
    /// </summary>
    [Fact]
    public async Task SeedAsync_LeavesThemesThatAreNoLongerInTheCode()
    {
        await using var context = new PresentationContext(options);
        context.Themes.Add(new Theme { Id = RetiredThemeId, OrganizationId = null, Definition = new SlideTheme() });
        await context.SaveChangesAsync();

        await BuiltInThemeSeeder.SeedAsync(context);

        (await context.Themes.AnyAsync(t => t.Id == RetiredThemeId)).ShouldBeTrue();
    }

    [Fact]
    public async Task SeedAsync_LeavesOrganizationThemesAlone()
    {
        await using var context = new PresentationContext(options);
        var org = new Organization { Id = "org-a", Name = "Org A" };
        context.Organizations.Add(org);
        context.Themes.Add(new Theme
        {
            Id = "org-theme",
            OrganizationId = org.Id,
            Name = "Ours",
            Definition = new SlideTheme { Song = new SlideStyle { MainText = new SlideTextStyle { FontSize = 70 } } }
        });
        await context.SaveChangesAsync();

        await BuiltInThemeSeeder.SeedAsync(context);

        var ours = await context.Themes.FirstAsync(t => t.Id == "org-theme");
        ours.Definition.Song.MainText.FontSize.ShouldBe(70);
    }

    /// <summary>The JSON column has to survive a round trip, or every theme would silently be Classic.</summary>
    [Fact]
    public async Task SeedAsync_StoresTheDefinitionSoItCanBeReadBack()
    {
        await using (var context = new PresentationContext(options))
        {
            await BuiltInThemeSeeder.SeedAsync(context);
        }

        await using var reader = new PresentationContext(options);
        var classic = await reader.Themes.AsNoTracking().FirstAsync(t => t.Id == BuiltInThemes.ClassicId);

        classic.Definition.ShouldBe(SlideTheme.Classic);
        classic.Definition.BibleText.MainText.Align.ShouldBe(SlideTextAlign.Left);
        classic.IsBuiltIn.ShouldBeTrue();
    }

    public void Dispose() => connection.Dispose();
}
