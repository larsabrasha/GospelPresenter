using GospelPresenter.Shared.Services;

namespace GospelPresenter.Client.Media;

/// <summary>
/// Maps between the media URL paths components render (the same /api/... paths the web serves),
/// the S3-style object keys the store is addressed by, and the server URLs blobs are downloaded
/// from. One place, so the webview scheme handler, the downloader and the pin service can never
/// disagree about a key.
/// </summary>
public static class MediaUrlResolver
{
    /// <summary>
    /// The object key a webview media request resolves to, or null when the path is not media
    /// (theme images have their own path — see <see cref="ThemeAssetPath"/>). Live URLs resolve
    /// like their authenticated twins: on the device there is exactly one organisation and no
    /// session gate.
    /// </summary>
    public static string? KeyForRequestPath(string path, string organizationId)
    {
        var segments = path.Trim('/').Split('/');
        if (segments.Length < 3 || segments[0] != "api")
            return null;

        // "/api/live-images/{sessionId}/..." → same shape as "/api/images/..." without the session
        if (segments[1] == "live-images" && segments.Length >= 5)
            segments = ["api", "images", .. segments[3..]];

        return segments switch
        {
            ["api", "images", "slides", var slidesId, var page] when int.TryParse(page, out var pageIndex) =>
                ImageUrlHelper.SlidesPageKey(organizationId, slidesId, pageIndex),
            ["api", "images", "org-image", var imageId, var variant] =>
                ImageUrlHelper.OrgImageKey(organizationId, imageId, variant),
            ["api", "images", "overlay", var overlayId, "image"] =>
                ImageUrlHelper.OverlayImageKey(organizationId, overlayId),
            ["api", "audio", "org-audio", var audioId] =>
                ImageUrlHelper.OrgAudioKey(organizationId, audioId),
            _ => null,
        };
    }

    /// <summary>The (slug, fileName) of a built-in theme asset request, or null.</summary>
    public static (string Slug, string FileName)? ThemeAssetRequest(string path)
    {
        var segments = path.Trim('/').Split('/');
        return segments is ["api", "theme-images", var slug, var fileName]
            ? (slug, fileName)
            : null;
    }

    /// <summary>
    /// The authenticated server URL a key's blob is downloaded from, or null for keys the server
    /// has no download endpoint for.
    /// </summary>
    public static string? ServerUrlForKey(string key)
    {
        var segments = key.Split('/');
        return segments switch
        {
            ["org", _, "images", var imageId, var variant] =>
                $"/api/images/org-image/{imageId}/{variant}",
            ["org", _, "overlays", var overlayId, "image"] =>
                $"/api/images/overlay/{overlayId}/image",
            ["org", _, "audios", var audioId, "file"] =>
                $"/api/audio/org-audio/{audioId}",
            ["org", _, "slides", var slidesId, var page]
                when page.StartsWith("page-") && page.EndsWith(".webp")
                     && int.TryParse(page["page-".Length..^".webp".Length], out var pageIndex) =>
                $"/api/images/slides/{slidesId}/{pageIndex}",
            _ => null,
        };
    }
}
