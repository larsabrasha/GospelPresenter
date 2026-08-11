namespace GospelPresenter.Shared.Services;

public static class ImageUrlHelper
{
    // HTTP API URLs (used by Razor components, requires auth)
    public static string OrgImageUrl(string imageId, string variant = "thumb")
        => $"/api/images/org-image/{imageId}/{variant}";

    public static string OverlayImageUrl(string overlayId)
        => $"/api/images/overlay/{overlayId}/image";

    // Live URLs (unauthenticated, only served while the session's presentation is active)
    public static string LiveOrgImageUrl(string sessionId, string imageId, string variant = "thumb")
        => $"/api/live-images/{sessionId}/org-image/{imageId}/{variant}";

    public static string LiveOverlayImageUrl(string sessionId, string overlayId)
        => $"/api/live-images/{sessionId}/overlay/{overlayId}/image";

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
        => $"/api/audio/org-audio/{audioId}";

    public static string OrgAudioKey(string organizationId, string audioId)
        => $"org/{organizationId}/audios/{audioId}/file";

    public static string OrgAudioPrefix(string organizationId, string audioId)
        => $"org/{organizationId}/audios/{audioId}/";

    public static string SlidesPageUrl(string slidesId, int page)
        => $"/api/images/slides/{slidesId}/{page}";

    public static string LiveSlidesPageUrl(string sessionId, string slidesId, int page)
        => $"/api/live-images/{sessionId}/slides/{slidesId}/{page}";

    public static string SlidesPageKey(string organizationId, string slidesId, int page)
        => $"org/{organizationId}/slides/{slidesId}/page-{page}.webp";

    public static string SlidesPrefix(string organizationId, string slidesId)
        => $"org/{organizationId}/slides/{slidesId}/";
}
