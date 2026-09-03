namespace GospelPresenter.Desktop;

/// <summary>
/// The server this installation talks to, most specific first:
///
///   GP_API_BASE_URL      environment variable, which is also what the Aspire AppHost sets
///   Server:BaseUrl       appsettings.json
///   the build's scheme   <see cref="DesktopBuild.ServerBaseUrl"/>
///
/// The MAUI app has only the first and the last, because an iOS bundle has nowhere to put a
/// setting before it runs; a desktop app does, so the middle one exists. It is not there for
/// switching between our own environments — that is what the scheme is for, and it also gives the
/// installation its own database and its own callback scheme, which a setting cannot — but so a
/// church running its own server behind its own tunnel can point the released app at it without
/// building anything.
///
/// Empty means "no server configured", and the app then runs the fixed developer identity instead
/// of the sign-in flow. Only the Local scheme is empty by default.
/// </summary>
public static class DesktopSettings
{
    public static string ResolveApiBaseUrl(IConfiguration configuration)
    {
        var url = Environment.GetEnvironmentVariable("GP_API_BASE_URL");
        if (string.IsNullOrWhiteSpace(url))
            url = configuration["Server:BaseUrl"];
        if (string.IsNullOrWhiteSpace(url))
            url = DesktopBuild.ServerBaseUrl;

        return string.IsNullOrWhiteSpace(url) ? "" : url.TrimEnd('/');
    }
}
