using System.Text.RegularExpressions;
using System.Xml.Linq;
using Shouldly;

namespace GospelPresenter.UnitTests.Localization;

/// <summary>
/// Pins the resource files against the code that reads them.
///
/// A missing key is invisible to the compiler and to every other test: IStringLocalizer returns the
/// key name rather than throwing, so a button whose string was deleted silently starts rendering
/// "SongTrash.Restore" to a user. That is exactly what happened when the per-kind trash pages were
/// replaced by one page and their strings were cleaned up along with them — SongHistory.razor was
/// still using two of them, and nothing caught it until someone opened the page.
///
/// The scan is deliberately simple: literal L["..."] lookups and LocalizedEmphasis Key="...".
/// Interpolated lookups (L[$"Weekday.{day}"]) cannot be checked this way and are skipped.
/// </summary>
public class ResourceKeyTests
{
    private static readonly Regex LiteralLookup = new(@"L\[\s*""([^""$]+)""", RegexOptions.Compiled);
    private static readonly Regex EmphasisKey = new(@"Key=""([A-Za-z][A-Za-z0-9_.]*)""", RegexOptions.Compiled);

    [Fact]
    public void EveryKeyTheCodeLooksUpExists()
    {
        var defined = KeysIn("SharedResource.resx");
        var missing = new List<string>();

        foreach (var file in SourceFiles())
        {
            var text = File.ReadAllText(file);
            foreach (Match match in LiteralLookup.Matches(text).Concat(EmphasisKey.Matches(text)))
            {
                var key = match.Groups[1].Value;
                // Not a key: the localizer's own parameter, and markup attributes that happen to be
                // called Key on components other than LocalizedEmphasis.
                if (!key.Contains('.')) continue;
                if (!defined.Contains(key))
                    missing.Add($"{key} (used in {Path.GetFileName(file)})");
            }
        }

        missing.Distinct().ShouldBeEmpty();
    }

    [Fact]
    public void BothLanguagesDefineTheSameKeys()
    {
        var english = KeysIn("SharedResource.resx");
        var swedish = KeysIn("SharedResource.sv.resx");

        english.Except(swedish).ShouldBeEmpty("these keys have no Swedish translation");
        swedish.Except(english).ShouldBeEmpty("these keys exist only in Swedish, so English falls back to the key name");
    }

    private static HashSet<string> KeysIn(string fileName)
    {
        var path = Path.Combine(SharedProjectRoot(), "Resources", "Localization", fileName);
        return XDocument.Load(path).Root!
            .Elements("data")
            .Select(d => d.Attribute("name")!.Value)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static IEnumerable<string> SourceFiles() =>
        Directory.EnumerateFiles(SharedProjectRoot(), "*.razor", SearchOption.AllDirectories)
            .Concat(Directory.EnumerateFiles(SharedProjectRoot(), "*.cs", SearchOption.AllDirectories))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

    /// <summary>
    /// Walks up from the test binary to the repository, which is where the .razor sources are. The
    /// test needs the sources themselves, not the compiled output.
    /// </summary>
    private static string SharedProjectRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "GospelPresenter.Shared");
            if (Directory.Exists(Path.Combine(candidate, "Resources", "Localization")))
                return candidate;
            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate GospelPresenter.Shared from " + AppContext.BaseDirectory);
    }
}
