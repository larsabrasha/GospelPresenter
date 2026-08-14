using System.Xml.Linq;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.UnitTests.Support;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Guards the two promises the built-in themes make: that they never render text the canvas cannot
/// hold, and that every one of them has a name and description in both languages.
/// </summary>
public class BuiltInThemeTests
{
    // 250 characters, the limit BibleTextService splits verses on. A theme that cannot hold this
    // clips Bible slides that were chunked before the theme was chosen.
    private const string WorstCaseBibleText =
        "For God so loved the world that he gave his one and only Son, that whoever believes in him "
        + "shall not perish but have eternal life. For God did not send his Son into the world to "
        + "condemn the world, but to save the world through him and live.";

    // Seven lines of at most 33 characters: a song part at the practical limit of what Classic holds,
    // kept just inside it because the estimator is an approximation and a sample sitting exactly on the
    // boundary would make this suite fail on a metric tweak rather than on a real overflow. Song parts
    // break where the author typed a newline, not where the text wraps.
    private const string WorstCaseSongText =
        "Amazing grace how sweet the sound\n"
        + "That saved a wretch like me\n"
        + "I once was lost but now am found\n"
        + "Was blind but now I see\n"
        + "Through many dangers and snares\n"
        + "I have already come\n"
        + "Tis grace that brought me safe";

    [Fact]
    public void ClassicHoldsTheWorstCaseText()
    {
        // The reference the invariant is expressed against: if this fails, the samples above claim a
        // capacity Classic never had and every other assertion here is measuring the wrong thing.
        SlideTextFitEstimator.Estimate(WorstCaseSongText, SlideTheme.Classic.Song.MainText)
            .FitsCanvas.ShouldBeTrue();
        SlideTextFitEstimator.Estimate(WorstCaseBibleText, SlideTheme.Classic.BibleText.MainText)
            .FitsCanvas.ShouldBeTrue();
    }

    [Theory]
    [MemberData(nameof(BuiltInThemeIds))]
    public void EveryBuiltInThemeHoldsTheWorstCaseText(string themeId)
    {
        var theme = Definition(themeId);

        SlideTextFitEstimator.Estimate(WorstCaseSongText, theme.Song.MainText)
            .FitsCanvas.ShouldBeTrue($"song text overflows the canvas in theme '{themeId}'");
        SlideTextFitEstimator.Estimate(WorstCaseBibleText, theme.BibleText.MainText)
            .FitsCanvas.ShouldBeTrue($"Bible text overflows the canvas in theme '{themeId}'");
    }

    /// <summary>
    /// The invariant from adr/0001-slide-themes.md: a theme may look different from Classic, but it may
    /// not need more room, because operators no longer have a text-size control to compensate with.
    /// </summary>
    [Theory]
    [MemberData(nameof(BuiltInThemeIds))]
    public void NoBuiltInThemeNeedsMoreRoomThanClassic(string themeId)
    {
        var theme = Definition(themeId);

        AssertNoLargerThanClassic(WorstCaseSongText, theme.Song.MainText, SlideTheme.Classic.Song.MainText, themeId);
        AssertNoLargerThanClassic(WorstCaseBibleText, theme.BibleText.MainText, SlideTheme.Classic.BibleText.MainText, themeId);
    }

    [Theory]
    [MemberData(nameof(BuiltInThemeIds))]
    public void EveryBuiltInThemeIsNamedInBothLanguages(string themeId)
    {
        foreach (var resourceFile in new[] { "SharedResource.resx", "SharedResource.sv.resx" })
        {
            var keys = ResourceKeys(resourceFile);
            keys.ShouldContain($"Theme.Name.{themeId}");
            keys.ShouldContain($"Theme.Description.{themeId}");
        }
    }

    /// <summary>
    /// The hash in a theme's image reference is what makes a changed background reach clients that cached
    /// the old URL for a year. If someone regenerates the art and forgets the constant, this fails.
    /// </summary>
    [Fact]
    public void ThemeBackgroundHashesMatchTheShippedArt()
    {
        var assets = new ThemeAssetService();

        var images = BuiltInThemes.All
            .SelectMany(theme => new[]
            {
                theme.Definition.Song.Background.Image,
                theme.Definition.BibleText.Background.Image,
                theme.Definition.Media.Image
            })
            .Where(image => image is { Source: SlideImageSource.BuiltInAsset })
            .Select(image => image!)
            .DistinctBy(image => image.Value)
            .ToList();

        images.ShouldNotBeEmpty("no built-in theme uses a background image, so the image path is untested");

        foreach (var image in images)
        {
            var actual = assets.ComputeContentHash(image.Value);
            actual.ShouldNotBeNull($"theme asset '{image.Value}' is not embedded in the assembly");
            actual.ShouldBe(image.ContentHash,
                $"the content hash for '{image.Value}' does not match the file; rerun "
                + "scripts/generate-theme-backgrounds.py and copy the printed hash into BuiltInThemes");
        }
    }

    [Fact]
    public void BuiltInThemeIdsAreUnique()
    {
        // Ids are foreign keys from presentations, so a duplicate would make the seeder overwrite one
        // theme with another.
        var ids = BuiltInThemes.All.Select(t => t.Id).ToList();
        ids.Distinct().Count().ShouldBe(ids.Count);
    }

    [Fact]
    public void ClassicIsShipped()
    {
        // Everything without a theme resolves to Classic, so it is the one id that must always exist.
        BuiltInThemes.All.Select(t => t.Id).ShouldContain(BuiltInThemes.ClassicId);
    }

    public static TheoryData<string> BuiltInThemeIds()
    {
        var data = new TheoryData<string>();
        foreach (var theme in BuiltInThemes.All) data.Add(theme.Id);
        return data;
    }

    private static SlideTheme Definition(string themeId) =>
        BuiltInThemes.All.First(t => t.Id == themeId).Definition;

    private static void AssertNoLargerThanClassic(string text, SlideTextStyle style, SlideTextStyle classic, string themeId)
    {
        var estimate = SlideTextFitEstimator.Estimate(text, style);
        var reference = SlideTextFitEstimator.Estimate(text, classic);

        // Height is the measure that matters. Width is not compared against Classic: wrapped text always
        // grows to fill the content box, so a *narrower* font produces a wider line — it fits more
        // characters before wrapping. That would punish exactly the themes that need the least room.
        // Overflow in either direction is covered by EveryBuiltInThemeHoldsTheWorstCaseText.
        estimate.Height.ShouldBeLessThanOrEqualTo(reference.Height,
            $"theme '{themeId}' needs more vertical room than Classic, and operators no longer have a "
            + "text-size control to compensate with");
    }

    private static IReadOnlyCollection<string> ResourceKeys(string fileName)
    {
        var path = Path.Combine(RepositoryRoot(), "GospelPresenter.Shared", "Resources", "Localization", fileName);
        return XDocument.Load(path)
            .Root!
            .Elements("data")
            .Select(e => e.Attribute("name")!.Value)
            .ToHashSet();
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "GospelPresenter.sln")))
            directory = directory.Parent;

        return directory?.FullName
               ?? throw new InvalidOperationException("Could not find the solution directory above the test output.");
    }
}
