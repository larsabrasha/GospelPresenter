using System.Reflection;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// The version of the running application, formatted for display.
/// </summary>
/// <remarks>
/// Only a release build knows a real version, and only for some hosts. desktop-release.yml derives
/// $(Version) from the pushed v* tag and passes it to publish; the MAUI release build overrides
/// ApplicationDisplayVersion the same way. Nothing sets a version for the web: docker-publish.yml
/// tags the *image* from web-v*, while the assembly keeps the 1.0.0 hardcoded in the csproj. And a
/// local build passes no version at all, so the SDK defaults it to 1.0.0.
///
/// So the version number alone is ambiguous — 1.0.0 is what a developer machine produces and what
/// an untagged main build reports. Two things disambiguate it. The commit sha, which the SDK's
/// SourceLink appends on its own wherever a .git directory is visible, and which CI passes
/// explicitly where it is not. And <see cref="IsDevelopmentBuild"/>, which the caller is expected
/// to show: a version that quietly claims to be a release when it is a Debug build off someone's
/// laptop is worse than no version at all.
/// </remarks>
public static class AppVersion
{
    // The entry assembly's attributes cannot change while the process runs, so this is read once.
    private static readonly Lazy<string?> display = new(Read);

    /// <summary>
    /// The version to show, or <c>null</c> when the host assembly carries no version metadata at
    /// all — in which case the caller should render nothing rather than a placeholder.
    /// </summary>
    public static string? Display => display.Value;

    /// <summary>
    /// True for a Debug build, which is every local run and no released artifact.
    /// </summary>
    public static bool IsDevelopmentBuild =>
#if DEBUG
        true;
#else
        false;
#endif

    private static string? Read()
    {
        // The entry assembly is the host, not this one: GospelPresenter.Desktop, GospelPresenter.Web
        // or the MAUI GospelPresenter, each versioned by its own build. Reading it is what lets the
        // one shared menu in LoginDisplay show the right number in all three without a per-host
        // service to register.
        //
        // Null under a test runner that has no managed entry assembly, which is why the caller has
        // to handle null rather than this returning a made-up "0.0".
        var assembly = Assembly.GetEntryAssembly();
        if (assembly is null)
            return null;

        return Format(
            assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            assembly.GetName().Version);
    }

    /// <summary>
    /// Turns the two version attributes into the one string shown on screen. Separate from
    /// <see cref="Read"/>, and internal, so it can be tested against inputs a test process cannot
    /// otherwise produce — its own entry assembly is the test host, whose version says nothing.
    /// </summary>
    internal static string? Format(string? informational, Version? assemblyVersion)
    {
        // AssemblyVersion as the fallback: it is always present, but it is the four-part binding
        // identity rather than the number a release is named after, so it is only reached when the
        // informational one is missing.
        if (string.IsNullOrWhiteSpace(informational))
            return assemblyVersion?.ToString();

        // The SDK appends "+<commit sha>" whenever $(SourceRevisionId) is set, and its built-in
        // SourceLink sets it by itself for any build that can see a .git directory — so this fires
        // on every local build without anyone asking for it. The one place it does not is the web
        // image: docker-publish.yml passes GospelPresenter as the build context and .git sits above
        // that, so the container never sees a repository. That is what the SOURCE_REVISION build
        // arg in the Dockerfile exists to replace.
        //
        // The sha is shortened rather than dropped: seven characters is what git itself shows, and
        // it is the part worth reading off a screen into a bug report.
        var plus = informational.IndexOf('+');
        if (plus < 0)
            return informational;

        var version = informational[..plus];
        var revision = informational[(plus + 1)..];
        return revision.Length > 7 ? $"{version}+{revision[..7]}" : informational;
    }
}
