namespace GospelPresenter.Web.Auth;

/// <summary>
/// Where a sign-in may send the user afterwards: somewhere on this site, or the front page. The
/// remote authentication handler redirects to whatever RedirectUri it was given, right after a real
/// login — the one moment a user trusts the address bar least — so an absolute URL, a
/// protocol-relative <c>//host</c> or the <c>/\host</c> form some browsers read as one all fall
/// back to <c>/</c>.
/// </summary>
public static class LocalReturnUrl
{
    public static string Sanitize(string? returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl)) return "/";
        if (returnUrl.Length < 1 || returnUrl[0] != '/') return "/";
        if (returnUrl.Length > 1 && returnUrl[1] is '/' or '\\') return "/";
        if (returnUrl.Contains('\n') || returnUrl.Contains('\r')) return "/";
        return returnUrl;
    }
}
