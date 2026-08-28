namespace GospelPresenter.Configuration;

public class Settings
{
    /// <summary>
    /// The server this app installation talks to, chosen by the build scheme (see
    /// Directory.Build.GospelPresenter*.props and the DefineConstants mapping in the csproj).
    /// Empty means "no server configured": DEBUG builds then run with the local developer
    /// identity instead of the sign-in flow.
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

        // TODO: fill in the real server URLs per environment.
#if SCHEME_PROD
        return "";
#elif SCHEME_BETA
        return "";
#else
        return "";
#endif
    }
}
