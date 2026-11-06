namespace GospelPresenter.Shared.Utils;

/// <summary>
/// Return URLs for the auth endpoints. A <c>returnUrl</c> arrives in a query string or form anyone can
/// craft, and the sign-in flow redirects to it once the provider is done, so an unchecked value is an
/// open redirect: a link to this site that ends on someone else's after a genuine sign-in.
/// </summary>
public static class LocalUrl
{
    public const string Fallback = "/";

    /// <summary>
    /// <paramref name="returnUrl"/> when it is a local path; the path of an absolute http(s) URL whose
    /// host is <paramref name="currentHost"/> (the request's Host, e.g. <c>example.org:8443</c>); and
    /// otherwise <c>/</c>. Only the host is compared, since behind a TLS-terminating proxy the request's
    /// own scheme is not the one the browser used.
    /// </summary>
    public static string OrFallback(string? returnUrl, string? currentHost = null)
    {
        if (string.IsNullOrEmpty(returnUrl))
            return Fallback;

        if (IsLocal(returnUrl))
            return returnUrl;

        if (!string.IsNullOrEmpty(currentHost)
            && Uri.TryCreate(returnUrl, UriKind.Absolute, out var absolute)
            && (absolute.Scheme == Uri.UriSchemeHttps || absolute.Scheme == Uri.UriSchemeHttp)
            && string.IsNullOrEmpty(absolute.UserInfo)
            && string.Equals(absolute.Authority, currentHost, StringComparison.OrdinalIgnoreCase))
        {
            var path = absolute.PathAndQuery + absolute.Fragment;
            return IsLocal(path) ? path : Fallback;
        }

        return Fallback;
    }

    /// <summary>
    /// The rule ASP.NET Core's <c>IUrlHelper.IsLocalUrl</c> applies: a single leading slash, not
    /// followed by another slash or a backslash (both make a protocol-relative URL to another host in
    /// browsers), and no control characters, which browsers strip before parsing.
    /// </summary>
    public static bool IsLocal(string? url)
    {
        if (string.IsNullOrEmpty(url) || url[0] != '/')
            return false;
        if (url.Length == 1)
            return true;
        if (url[1] is '/' or '\\')
            return false;
        return !url.Any(char.IsControl);
    }
}
