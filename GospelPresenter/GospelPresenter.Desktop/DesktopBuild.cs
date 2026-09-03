using System.Reflection;

namespace GospelPresenter.Desktop;

/// <summary>
/// Which installation this build is. The reading end of the <c>Scheme</c> property and the
/// <c>Directory.Build.GospelPresenter*.props</c> files beside the project file, carried into the
/// assembly as metadata by MSBuild.
///
///   GospelPresenterProd    app.gospelpresenter.com      gospelpresenter://        GospelPresenter
///   GospelPresenterTest    apptest.gospelpresenter.com  gospelpresenter-test://   GospelPresenter Test
///   GospelPresenterLocal   no server                    gospelpresenter-local://  GospelPresenter Local
///
/// Metadata rather than <c>DefineConstants</c>, which is how the MAUI app does the same job: an
/// iOS bundle has nowhere to put a setting before it runs, so its scheme has to be compiled in,
/// whereas one desktop binary can be told what it is. The values still come from the build — the
/// point is that they are data the app reads, not branches it contains.
///
/// Why this is a build parameter and not a setting the user switches is
/// adr/0005-desktop-build-schemes.md — the short version being that the local database holds sync
/// state belonging to the server that produced it, so "switch server" has no meaning short of
/// starting over.
///
/// The three are separate values on purpose, and none is derived from another.
/// <see cref="AppFolderName"/> in particular is not <c>$(Title)</c>: existing installations keep
/// their database, media library and device token under "GospelPresenter", and deriving the
/// directory from the display name would rename it to "Gospel Presenter" and silently start them
/// over with an empty library.
/// </summary>
public static class DesktopBuild
{
    /// <summary>
    /// The server this build is for, before <c>GP_API_BASE_URL</c> or <c>appsettings.json</c> get a
    /// say — see <see cref="DesktopSettings.ResolveApiBaseUrl"/>, which is what the app uses.
    /// Empty for the Local scheme, which is what selects the developer identity.
    /// </summary>
    public static string ServerBaseUrl { get; } = Optional("ServerBaseUrl");

    /// <summary>
    /// The URL scheme this installation answers sign-ins on, without the <c>://</c>. Told to the
    /// server as <c>?callback_scheme=</c>, claimed from the OS at startup, and declared in the
    /// bundle by electron-builder's <c>protocols:</c> block — all three have to agree, or the
    /// token is handed to an app that is not this one.
    /// </summary>
    public static string CallbackScheme { get; } = Required("CallbackScheme");

    /// <summary>
    /// The directory this installation keeps its files under, and the name it keys its macOS
    /// keychain entry on. Distinct per scheme because sync state belongs to the server that
    /// produced it: two installations sharing a directory would not merely mix data, they would
    /// each pull against the other's watermark.
    /// </summary>
    public static string AppFolderName { get; } = Required("AppFolderName");

    /// <summary>
    /// What the app calls itself where a person reads it — the window title. The same name
    /// electron-builder puts in the Dock, the menu bar and the installer, so an operator with both
    /// installed can tell at a glance which one is in front of them.
    /// </summary>
    public static string ProductName { get; } = Required("ProductName");

    /// <summary>
    /// Whether this build's packaging config names a publish provider, and therefore whether
    /// electron-updater has manifests to read. False for Test and Local: the only feed configured
    /// anywhere is this repository's GitHub Releases, which carries the real app's releases, so a
    /// build without its own feed must not look for one — it would find the real app's.
    /// </summary>
    public static bool HasUpdateFeed { get; } = Optional("HasUpdateFeed") == "true";

    private static string Optional(string key) =>
        typeof(DesktopBuild).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == key)
            ?.Value ?? "";

    /// <summary>
    /// Loud rather than defaulted. A missing value means the build did not import a scheme's
    /// props file, and every default worth having here is wrong: falling back to the production
    /// callback scheme would take another app's sign-ins, and falling back to the production
    /// folder name would open the real installation's database. GP0002 in the project file stops
    /// this before a build finishes, so reaching it means something upstream of that changed.
    /// </summary>
    private static string Required(string key)
    {
        var value = Optional(key);
        if (value.Length == 0)
        {
            throw new InvalidOperationException(
                $"The build carries no {key}. Build with -p:Scheme=GospelPresenterProd, " +
                "-p:Scheme=GospelPresenterTest or -p:Scheme=GospelPresenterLocal, and see " +
                "Directory.Build.GospelPresenter*.props for what each one sets.");
        }

        return value;
    }
}
