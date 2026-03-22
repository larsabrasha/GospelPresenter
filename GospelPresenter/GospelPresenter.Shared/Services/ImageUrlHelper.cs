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

    // S3 object keys (used by services and API endpoints)
    public static string OrgImageKey(string organizationId, string imageId, string variant)
        => $"org/{organizationId}/images/{imageId}/{variant}";

    public static string OrgImagePrefix(string organizationId, string imageId)
        => $"org/{organizationId}/images/{imageId}/";

    public static string OverlayImageKey(string organizationId, string overlayId)
        => $"org/{organizationId}/overlays/{overlayId}/image";
}
