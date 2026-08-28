namespace GospelPresenter.Client.Data;

/// <summary>
/// The local media store's ledger: one row per blob, keyed by the same S3-style key the server
/// uses (they are a pure function of entity ids). Pinned blobs — a presentation's own media, an
/// opted-in library — are never evicted; the rest are an LRU cache trimmed against a size budget.
/// </summary>
public class MediaCacheEntry
{
    /// <summary>The S3-style object key, e.g. <c>org/{orgId}/images/{imageId}/full</c>.</summary>
    public string Key { get; set; } = "";

    /// <summary>Path of the blob file, relative to the media store's root directory.</summary>
    public string FilePath { get; set; } = "";

    public string ContentType { get; set; } = "application/octet-stream";
    public long SizeBytes { get; set; }
    public DateTimeOffset LastAccessAt { get; set; }
    public bool Pinned { get; set; }
    public MediaCacheState State { get; set; }
}

public enum MediaCacheState
{
    /// <summary>Downloaded from the server; evictable when not pinned.</summary>
    Cached,

    /// <summary>Created locally; must reach the server before it may ever be evicted.</summary>
    PendingUpload,
}
