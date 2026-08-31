namespace GospelPresenter.Desktop;

/// <summary>
/// Where the desktop app keeps its files. Carries over the reasoning from
/// adr/0002-app-distribution-and-updates.md (20)–(23), which survives the move off Mac Catalyst:
/// data lives under a directory named for the application, logs live where the platform's log
/// viewer looks, and neither is strewn loose in a directory the user shares with everything else.
///
///   macOS    ~/Library/Application Support/GospelPresenter/ and ~/Library/Logs/GospelPresenter/
///   Windows  %LOCALAPPDATA%\GospelPresenter\ with logs beside the data
///   Linux    $XDG_DATA_HOME or ~/.local/share/GospelPresenter/
/// </summary>
public static class DesktopPaths
{
    private const string AppFolderName = "GospelPresenter";

    public static string DataDirectory { get; } = Ensure(ResolveDataDirectory());

    public static string LogDirectory { get; } = Ensure(ResolveLogDirectory());

    private static string ResolveDataDirectory()
    {
        if (OperatingSystem.IsMacOS())
            return Path.Combine(Home, "Library", "Application Support", AppFolderName);

        // ApplicationData is %APPDATA% on Windows and honours XDG_DATA_HOME on Linux.
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            AppFolderName);
    }

    private static string ResolveLogDirectory() =>
        // Console.app indexes ~/Library/Logs, so a volunteer can find and send a log without being
        // told what an application support directory is. No other platform has an equivalent.
        OperatingSystem.IsMacOS()
            ? Path.Combine(Home, "Library", "Logs", AppFolderName)
            : Path.Combine(DataDirectory, "logs");

    private static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// <summary>SQLite will not open a database in a directory that does not exist.</summary>
    private static string Ensure(string path)
    {
        Directory.CreateDirectory(path);
        return path;
    }
}
