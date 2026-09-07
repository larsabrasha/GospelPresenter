namespace GospelPresenter.Web;

/// <summary>
/// How every stored blob leaves the server. The type a blob is served under was decided when it was
/// stored, and the browser must not be allowed to second-guess it: without <c>nosniff</c> a browser
/// may read a response as HTML because it looks like HTML, whatever the header says. The
/// disposition keeps a blob from being anything but a resource on the page it belongs to.
/// </summary>
public static class MediaResponses
{
    public const string CacheForever = "public, max-age=31536000, immutable";

    /// <summary>Session-gated content: the session ends, the right to hold a copy ends with it.</summary>
    public const string CacheBrieflyAndPrivately = "private, max-age=3600";

    public static IResult File(HttpContext context, Stream stream, string contentType, string cacheControl,
        bool enableRangeProcessing = false)
    {
        SetHeaders(context, cacheControl);
        return Results.File(stream, contentType, enableRangeProcessing: enableRangeProcessing);
    }

    public static IResult File(HttpContext context, byte[] bytes, string contentType, string cacheControl)
    {
        SetHeaders(context, cacheControl);
        return Results.File(bytes, contentType);
    }

    private static void SetHeaders(HttpContext context, string cacheControl)
    {
        context.Response.Headers.CacheControl = cacheControl;
        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.ContentDisposition = "inline";
    }
}
