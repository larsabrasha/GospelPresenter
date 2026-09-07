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

    /// <summary>
    /// How long "this user has not chosen a language" is remembered before the database is asked
    /// again. Users who have chosen one are recognised by their culture cookie and never reach the
    /// lookup, so this only affects users with nothing stored — for whom the lookup would otherwise
    /// repeat on every request, including every static asset.
    /// </summary>
    public int PreferredLanguageCacheSeconds { get; set; } = 300;

    /// <summary>
    /// The networks whose X-Forwarded-For / X-Forwarded-Proto headers are believed. Production sits
    /// behind a Cloudflare Tunnel connector in the same Docker network, so the private ranges cover
    /// it; anything arriving from elsewhere has its forwarded headers ignored rather than trusted.
    /// Comma-separated CIDR notation.
    /// </summary>
    public string TrustedProxyNetworks { get; set; } = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128";

    public static readonly string ApiBaseUrl = "";
}
