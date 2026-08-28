#if MACCATALYST
using Foundation;
#endif

namespace GospelPresenter.Services;

/// <summary>
/// Where the app keeps its files. See adr/0002-app-distribution-and-updates.md (20)–(23).
///
/// MAUI's <c>FileSystem.AppDataDirectory</c> resolves to the user's Library directory on Apple
/// platforms. Inside a sandbox that is a private container per app, so unqualified names are safe.
/// The Mac Catalyst build is not sandboxed, and there it is literally <c>~/Library</c> — writing
/// <c>gospelpresenter.db</c>, <c>identity.json</c>, <c>log.txt</c> and a directory called
/// <c>media</c> into the root of it, next to Apple's own. Hence the bundle identifier prefix, under
/// the directories Apple's File System Programming Guide reserves for each kind of file:
///
///   ~/Library/Application Support/com.gospelpresenter.app/   data that must survive
///   ~/Library/Logs/GospelPresenter/                          logs, which Console.app indexes
///
/// Both are keyed on identity the build scheme already varies, so the test scheme
/// (com.gospelpresenter.app.test, display name "GospelPresenter Test") separates for free.
///
/// Every other platform keeps <c>AppDataDirectory</c>: iOS is sandboxed by the OS, Android likewise,
/// and on Windows it already resolves under a per-application %LOCALAPPDATA% directory.
/// </summary>
public static class AppPaths
{
    /// <summary>The database, the cached identity and the media store.</summary>
    public static string DataDirectory { get; } = ResolveDataDirectory();

    /// <summary>Serilog's rolling file. Separate from <see cref="DataDirectory"/> on macOS only.</summary>
    public static string LogDirectory { get; } = ResolveLogDirectory();

    private static string ResolveDataDirectory()
    {
#if MACCATALYST
        var appSupport = AppleDirectory(NSSearchPathDirectory.ApplicationSupportDirectory);
        if (appSupport is not null && NSBundle.MainBundle.BundleIdentifier is { Length: > 0 } bundleId)
            return Ensure(Path.Combine(appSupport, bundleId));
#endif
        return Ensure(FileSystem.Current.AppDataDirectory);
    }

    private static string ResolveLogDirectory()
    {
#if MACCATALYST
        // ~/Library/Logs is what Console.app lists, so a volunteer can find and send a log without
        // being told what a bundle identifier is. There is no NSSearchPathDirectory for it.
        var library = AppleDirectory(NSSearchPathDirectory.LibraryDirectory);
        if (library is not null && AppInfo.Current.Name is { Length: > 0 } appName)
            return Ensure(Path.Combine(library, "Logs", appName));
#endif
        return DataDirectory;
    }

#if MACCATALYST
    private static string? AppleDirectory(NSSearchPathDirectory directory)
    {
        var urls = NSFileManager.DefaultManager.GetUrls(directory, NSSearchPathDomain.User);
        return urls.Length > 0 ? urls[0].Path : null;
    }
#endif

    /// <summary>
    /// Creating the directories here rather than at each call site: SQLite will not open a database
    /// in a directory that does not exist, and it is one guarantee instead of four.
    /// </summary>
    private static string Ensure(string path)
    {
        Directory.CreateDirectory(path);
        return path;
    }
}
