namespace GospelPresenter.Web.Configuration;

public class Settings
{
    public string? DataProtectionKeysDirectory { get; set; }
    public int SessionTimeoutMinutes { get; set; } = 240;

    /// <summary>
    /// How long a "this account still exists" answer is reused before the database is asked again.
    /// The cookie is validated on every request that carries it — including each static asset — so
    /// without this a single page load would cost one query per file. The trade-off is that a
    /// deleted account keeps working on plain HTTP requests for at most this long; open Blazor
    /// circuits are checked separately once a minute.
    /// </summary>
    public int SessionRevalidationCacheSeconds { get; set; } = 30;

    public static readonly string ApiBaseUrl = "";
}
