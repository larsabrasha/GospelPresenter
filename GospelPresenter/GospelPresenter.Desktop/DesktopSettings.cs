namespace GospelPresenter.Desktop;

/// <summary>
/// The server this installation talks to. The MAUI app picks one at build time from its scheme,
/// because an iOS bundle has nowhere to put a setting before it runs; a desktop app does, so this
/// one is configured rather than compiled.
///
///   GP_API_BASE_URL      environment variable, which is also what the Aspire AppHost sets
///   Server:BaseUrl       appsettings.json
///
/// Empty means "no server configured", and the app then runs the fixed developer identity instead
/// of the sign-in flow — the same fallback the MAUI host's Local scheme has.
/// </summary>
public static class DesktopSettings
{
    public static string ResolveApiBaseUrl(IConfiguration configuration)
    {
        var url = Environment.GetEnvironmentVariable("GP_API_BASE_URL");
        if (string.IsNullOrWhiteSpace(url))
            url = configuration["Server:BaseUrl"];

        return string.IsNullOrWhiteSpace(url) ? "" : url.TrimEnd('/');
    }
}
