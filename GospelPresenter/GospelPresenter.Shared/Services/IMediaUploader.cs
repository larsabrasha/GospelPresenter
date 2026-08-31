namespace GospelPresenter.Shared.Services;

/// <summary>
/// Takes files into the organisation's media library. The web has no implementation and keeps its
/// JS path: a hidden file input POSTs to /api/upload/*, which is what the browser is good at. The
/// device app has no such server — a relative URL there resolves against the webview's own origin
/// and reaches nothing — so it registers an implementation that picks files natively and calls the
/// domain services directly, which is also what makes uploads work with no network at all.
///
/// Components resolve this optionally and fall back to the JS path when it is absent. Both routes
/// report the same JSON the upload endpoints return, so the callbacks on either side are identical.
/// </summary>
public interface IMediaUploader
{
    /// <summary>
    /// Presents a file picker and ingests whatever the user chooses. Returns when every file has
    /// been handled; per-file progress and failures arrive through <paramref name="callbacks"/>.
    /// </summary>
    Task PickAndUploadAsync(MediaUploadTarget target, MediaUploadCallbacks callbacks,
        CancellationToken cancellationToken = default);
}

public enum MediaUploadKind
{
    OrganizationImage,
    OrganizationAudio,
    OverlayImage,
}

public sealed record MediaUploadTarget(MediaUploadKind Kind, string OrganizationId, string? OverlayId = null);

/// <summary>
/// Mirrors the four JSInvokable callbacks the JS uploader drives, so a component's existing
/// handlers serve both routes unchanged. <paramref name="Uploaded"/> carries the endpoint's JSON.
/// </summary>
public sealed record MediaUploadCallbacks(
    Action<int> Started,
    Action<string> Uploaded,
    Action<string> Failed,
    Action Completed);
