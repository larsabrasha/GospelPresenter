using GospelPresenter.UnitTests.Support;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// Guards the invariant, rather than the mechanism that implements it.
///
/// A raw <c>&lt;input value="@field" @oninput="…"&gt;</c> puts the field's value under server
/// control, and on a Blazor circuit that means any render landing mid-typing writes back a value
/// the keyboard has already moved past — characters swap or jump backwards. Every text field in
/// the app therefore goes through SimpleInput, FloatingInput or FloatingTextarea, which own their
/// value from the first keystroke (see DomOwnedInputBase).
///
/// <see cref="DomOwnedInputTests"/> covers the mechanism. This test covers the thing the
/// mechanism is for: that no field is added next year that quietly opts out of it. It is the only
/// check that catches a *new* field, and the compiler cannot help — Razor accepts an unknown
/// component parameter and fails at runtime, so a hand-rolled input compiles perfectly.
///
/// The scanning itself lives in <see cref="RazorInputScanner"/>, with its own tests in
/// <see cref="RazorInputScannerTests"/>: it has enough edge cases to be worth testing rather
/// than trusting inside an assertion.
/// </summary>
public class ServerOwnedInputValueTests
{
    /// <summary>The components that implement the rule, and so are allowed to render the value.</summary>
    private static readonly string[] Implementations =
    [
        "SimpleInput.razor",
        "FloatingInput.razor",
        "FloatingTextarea.razor"
    ];

    [Fact]
    public void NoTextFieldOwnsItsValueOnTheServer()
    {
        var root = FindSolutionDirectory();

        var offenders = RazorFiles(root)
            .Where(file => !Implementations.Contains(Path.GetFileName(file)))
            .SelectMany(file => RazorInputScanner
                .ServerOwnedFields(File.ReadAllText(file))
                .Select(tag => (File: Path.GetRelativePath(root, file), Tag: tag)))
            .ToList();

        offenders.ShouldBeEmpty(
            "These fields render their own value and hand it to the server, which writes it back " +
            "mid-typing. Use SimpleInput, FloatingInput or FloatingTextarea instead — see " +
            "DomOwnedInputBase. The fields exempt from the rule are defined by " +
            "RazorInputScanner.IsExempt.\n\n" +
            string.Join("\n\n", offenders.Select(o => $"{o.File}\n{o.Tag}")));
    }

    /// <summary>
    /// Every project, not just the shared one: a host can add its own components, and a field
    /// added there would otherwise be invisible to the rule.
    /// </summary>
    private static IEnumerable<string> RazorFiles(string root) =>
        Directory
            .EnumerateFiles(root, "*.razor", SearchOption.AllDirectories)
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") &&
                           !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

    private static string FindSolutionDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "GospelPresenter.Shared", "GospelPresenter.Shared.csproj")))
                return directory.FullName;

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException(
            $"Could not find the directory holding GospelPresenter.Shared above {AppContext.BaseDirectory}.");
    }
}
