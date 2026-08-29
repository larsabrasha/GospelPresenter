namespace GospelPresenter.Configuration;

public class Settings
{
    /// <summary>
    /// The server this app installation talks to, chosen by the build scheme (see
    /// Directory.Build.GospelPresenter*.props and the DefineConstants mapping in the csproj).
    ///
    ///   Prod  → https://app.gospelpresenter.com   both update channels, stable and beta
    ///   Test  → https://apptest.gospelpresenter.com
    ///   Local → empty
    ///
    /// Empty means "no server configured": a DEBUG build then runs with the fixed developer
    /// identity instead of the sign-in flow. Only the Local scheme is empty, and only DEBUG has
    /// that fallback — a Release build of Local has neither a server nor an identity, which is
    /// correct, because Local is a development scheme and is never released.
    /// </summary>
    public static readonly string ApiBaseUrl = ResolveApiBaseUrl();

    private static string ResolveApiBaseUrl()
    {
#if DEBUG
        // Lets a developer point the app at any server (e.g. a local one) without rebuilding:
        // GP_API_BASE_URL=https://localhost:5001 when launching from a terminal.
        var overrideUrl = Environment.GetEnvironmentVariable("GP_API_BASE_URL");
        if (!string.IsNullOrWhiteSpace(overrideUrl))
            return overrideUrl.TrimEnd('/');
#endif

#if SCHEME_PROD
        return "https://app.gospelpresenter.com";
#elif SCHEME_TEST
        return "https://apptest.gospelpresenter.com";
#else
        // SCHEME_LOCAL, and any scheme name that did not match: no server. The stable and beta
        // update channels both point at production, so they are one scheme and one URL — the
        // channel is a release-time parameter, not a build. See the ADR (9), (12)–(15).
        return "";
#endif
    }
}
