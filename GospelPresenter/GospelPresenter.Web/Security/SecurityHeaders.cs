namespace GospelPresenter.Web.Security;

/// <summary>
/// The response headers every page and API answer carries. None of them is the fence — the
/// authorisation checks are — but each closes a class of browser behaviour an attacker would lean
/// on once past it: MIME sniffing a blob into HTML, framing the operator UI from another site,
/// leaking the URL (with a session or a watch code in it) to a linked site.
///
/// The public watch page is the one surface a congregation may legitimately embed in its own
/// website, so it and its stream are not told to refuse framing. Everything else is.
///
/// A script-src policy is deliberately not set yet: Blazor Server's boot script is inline in
/// App.razor and the shared JS is loaded by src, both of which a nonce could cover — but only once
/// the remaining inline handlers are gone. Until then a policy would either be a lie or break the
/// app; neither is worth having.
/// </summary>
public static class SecurityHeaders
{
    private const string FrameableCsp = "object-src 'none'; base-uri 'self'";
    private const string UnframeableCsp = "frame-ancestors 'none'; " + FrameableCsp;

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) =>
        app.Use((context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                headers.XContentTypeOptions = "nosniff";
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

                if (MayBeFramed(context.Request.Path))
                {
                    headers.ContentSecurityPolicy = FrameableCsp;
                }
                else
                {
                    headers.XFrameOptions = "DENY";
                    headers.ContentSecurityPolicy = UnframeableCsp;
                }
                return Task.CompletedTask;
            });
            return next(context);
        });

    private static bool MayBeFramed(PathString path) =>
        path.StartsWithSegments("/watch") || path.StartsWithSegments("/api/watch");
}
