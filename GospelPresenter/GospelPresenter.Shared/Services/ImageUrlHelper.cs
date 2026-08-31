namespace GospelPresenter.Shared.Services;

public static class ImageUrlHelper
{
    /// <summary>
    /// How a media URL reaches its host. The web serves media over its own HTTP endpoints, so the
    /// default is the identity. The MAUI app sets this once at startup to rewrite the same paths
    /// onto its custom scheme (<c>gpmedia://media/api/...</c>), where a webview handler serves the
    /// bytes from the local media store. Applied to every URL components render — never to object
    /// keys, and never to the /watch proxy URLs, which are always remote.
    /// </summary>
    public static Func<string, string> HostUrlTransform { get; set; } = url => url;

    // HTTP API URLs (used by Razor components, requires auth)
    public static string OrgImageUrl(string imageId, string variant = "thumb")
        => HostUrlTransform($"/api/images/org-image/{imageId}/{variant}");

    public static string OverlayImageUrl(string overlayId)
        => HostUrlTransform($"/api/images/overlay/{overlayId}/image");

    // Live URLs (unauthenticated, only served while the session's presentation is active)
    public static string LiveOrgImageUrl(string sessionId, string imageId, string variant = "thumb")
        => HostUrlTransform($"/api/live-images/{sessionId}/org-image/{imageId}/{variant}");

    public static string LiveOverlayImageUrl(string sessionId, string overlayId)
        => HostUrlTransform($"/api/live-images/{sessionId}/overlay/{overlayId}/image");

    // Public output (watch) URLs (unauthenticated, keyed on the output code rather than the
    // session id, so the operator's session id is never published to the visitors' devices —
    // and so that switching the output off stops the images immediately).
    public static string LiveImagePrefix(string sessionId)
        => $"/api/live-images/{sessionId}/";

    public static string WatchImagePrefix(string outputCode)
        => $"/api/watch/{outputCode}/image/";

    /// <summary>
    /// Rewrites a live image URL so it is served through a public output's proxy instead.
    /// The live URL layout is fixed, so replacing the prefix covers org images, overlays
    /// and imported presentation pages alike.
    /// </summary>
    public static string? ToWatchUrl(string? liveUrl, string sessionId, string outputCode)
        => liveUrl?.Replace(LiveImagePrefix(sessionId), WatchImagePrefix(outputCode), StringComparison.Ordinal);

    // S3 object keys (used by services and API endpoints)
    public static string OrgImageKey(string organizationId, string imageId, string variant)
        => $"org/{organizationId}/images/{imageId}/{variant}";

    public static string OrgImagePrefix(string organizationId, string imageId)
        => $"org/{organizationId}/images/{imageId}/";

    public static string OverlayImageKey(string organizationId, string overlayId)
        => $"org/{organizationId}/overlays/{overlayId}/image";

    // Audio URLs
    public static string OrgAudioUrl(string audioId)
        => HostUrlTransform($"/api/audio/org-audio/{audioId}");

    public static string OrgAudioKey(string organizationId, string audioId)
        => $"org/{organizationId}/audios/{audioId}/file";

    public static string OrgAudioPrefix(string organizationId, string audioId)
        => $"org/{organizationId}/audios/{audioId}/";

    /// <summary>
    /// The URL for a theme's background image. Built-in theme art is product graphics rather than
    /// congregation data, so it is served unauthenticated and cached hard, with a content hash baked
    /// into the asset path because built-in themes are updated in place.
    ///
    /// Organisation-owned backgrounds will need the live/watch proxy treatment the way other uploaded
    /// images do, which is why the theme stores a discriminated reference instead of a URL. No theme
    /// produces that kind yet.
    /// </summary>
    public static string? ThemeBackgroundUrl(State.SlideBackgroundImage? image, string variant = "full") => image switch
    {
        null => null,
        { Source: State.SlideImageSource.BuiltInAsset } =>
            HostUrlTransform($"/api/theme-images/{image.Value}-{variant}-{image.ContentHash}.webp"),
        _ => null
    };

    /// <summary>The object key a built-in theme asset is uploaded to. Mirrors the URL, hash included.</summary>
    public static string ThemeAssetKey(string assetPath, string variant, string contentHash)
        => $"themes/{assetPath}-{variant}-{contentHash}.webp";

    public static string SlidesPageUrl(string slidesId, int page)
        => HostUrlTransform($"/api/images/slides/{slidesId}/{page}");

    public static string LiveSlidesPageUrl(string sessionId, string slidesId, int page)
        => HostUrlTransform($"/api/live-images/{sessionId}/slides/{slidesId}/{page}");

    public static string SlidesPageKey(string organizationId, string slidesId, int page)
        => $"org/{organizationId}/slides/{slidesId}/page-{page}.webp";

    public static string SlidesPrefix(string organizationId, string slidesId)
        => $"org/{organizationId}/slides/{slidesId}/";
}
