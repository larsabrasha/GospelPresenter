using GospelPresenter.Client.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Media;

/// <summary>
/// The device's blob store: files on disk under the same S3-style keys the server uses, with a
/// ledger row per blob in MediaCache. Blobs created locally are PendingUpload until the media
/// synchronizer has pushed them; blobs downloaded from the server are Cached. Pinned blobs (media
/// a local presentation references) are never evicted; the rest are an LRU cache trimmed against
/// a size budget. PendingUpload rows are never evicted regardless of pinning — they exist nowhere
/// else in the world.
/// </summary>
public class MediaStore(
    IDbContextFactory<ClientDataContext> contextFactory,
    string rootDirectory,
    ILogger<MediaStore> logger)
{
    public const long DefaultBudgetBytes = 2L * 1024 * 1024 * 1024;

    /// <summary>LastAccessAt writes are throttled: LRU needs rough order, not per-read precision.</summary>
    private static readonly TimeSpan AccessTouchInterval = TimeSpan.FromMinutes(10);

    public async Task SaveAsync(
        string key, byte[] data, string contentType, MediaCacheState state, bool pinned,
        CancellationToken cancellationToken = default)
    {
        var relativePath = key.Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.Combine(rootDirectory, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await File.WriteAllBytesAsync(fullPath, data, cancellationToken);

        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entry = await db.MediaCache.FindAsync([key], cancellationToken);
        if (entry is null)
        {
            entry = new MediaCacheEntry { Key = key };
            db.MediaCache.Add(entry);
        }

        entry.FilePath = relativePath;
        entry.ContentType = contentType;
        entry.SizeBytes = data.Length;
        entry.LastAccessAt = DateTimeOffset.UtcNow;
        entry.Pinned = pinned || entry.Pinned;
        // A write over a not-yet-uploaded blob must stay PendingUpload whatever the caller says.
        if (state == MediaCacheState.PendingUpload || entry.State == MediaCacheState.PendingUpload)
            entry.State = MediaCacheState.PendingUpload;
        else
            entry.State = state;

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entry = await db.MediaCache.FindAsync([key], cancellationToken);
        if (entry is null)
            return null;

        var fullPath = Path.Combine(rootDirectory, entry.FilePath);
        if (!File.Exists(fullPath))
        {
            // The ledger and the disk disagree (a crash mid-write, manual cleanup): heal the ledger.
            logger.LogWarning("The media ledger pointed at a missing file for {Key}; forgetting it", key);
            db.MediaCache.Remove(entry);
            await db.SaveChangesAsync(cancellationToken);
            return null;
        }

        if (DateTimeOffset.UtcNow - entry.LastAccessAt > AccessTouchInterval)
        {
            entry.LastAccessAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }

        return (File.OpenRead(fullPath), entry.ContentType);
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entry = await db.MediaCache.FindAsync([key], cancellationToken);
        if (entry is null)
            return;
        RemoveFile(entry);
        db.MediaCache.Remove(entry);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entries = await db.MediaCache.Where(m => m.Key.StartsWith(prefix)).ToListAsync(cancellationToken);
        foreach (var entry in entries)
        {
            RemoveFile(entry);
            db.MediaCache.Remove(entry);
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Local copies exist nowhere else yet, so they are queued for upload even when their source
    /// was a download — the destination key is new to the server (a presentation copied from a
    /// template gets fresh slide deck ids, and the pushed metadata will point at them).
    /// </summary>
    public async Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var sources = await db.MediaCache.Where(m => m.Key.StartsWith(sourcePrefix)).ToListAsync(cancellationToken);
        foreach (var source in sources)
        {
            var sourcePath = Path.Combine(rootDirectory, source.FilePath);
            if (!File.Exists(sourcePath))
                continue;
            var destKey = destPrefix + source.Key[sourcePrefix.Length..];
            var bytes = await File.ReadAllBytesAsync(sourcePath, cancellationToken);
            await SaveAsync(destKey, bytes, source.ContentType, MediaCacheState.PendingUpload, source.Pinned, cancellationToken);
        }
    }

    public async Task<List<MediaCacheEntry>> GetPendingUploadsAsync(CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        return await db.MediaCache.AsNoTracking()
            .Where(m => m.State == MediaCacheState.PendingUpload)
            .OrderBy(m => m.LastAccessAt)
            .ToListAsync(cancellationToken);
    }

    public Task<byte[]> ReadBytesAsync(MediaCacheEntry entry, CancellationToken cancellationToken = default) =>
        File.ReadAllBytesAsync(Path.Combine(rootDirectory, entry.FilePath), cancellationToken);

    public async Task MarkUploadedAsync(string key, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entry = await db.MediaCache.FindAsync([key], cancellationToken);
        if (entry is null)
            return;
        entry.State = MediaCacheState.Cached;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<HashSet<string>> GetKnownKeysAsync(CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        return (await db.MediaCache.AsNoTracking().Select(m => m.Key).ToListAsync(cancellationToken)).ToHashSet();
    }

    /// <summary>Makes the ledger's pin flags exactly the wanted set (uploads keep their protection anyway).</summary>
    public async Task ApplyPinsAsync(HashSet<string> wantedPinnedKeys, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var entries = await db.MediaCache.ToListAsync(cancellationToken);
        foreach (var entry in entries)
            entry.Pinned = wantedPinnedKeys.Contains(entry.Key);
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Evicts unpinned cached blobs, least recently used first, until the total fits the budget.</summary>
    public async Task EvictOverBudgetAsync(long budgetBytes, CancellationToken cancellationToken = default)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var total = await db.MediaCache.SumAsync(m => m.SizeBytes, cancellationToken);
        if (total <= budgetBytes)
            return;

        var evictable = await db.MediaCache
            .Where(m => !m.Pinned && m.State == MediaCacheState.Cached)
            .OrderBy(m => m.LastAccessAt)
            .ToListAsync(cancellationToken);

        var evicted = 0;
        foreach (var entry in evictable)
        {
            if (total <= budgetBytes)
                break;
            RemoveFile(entry);
            db.MediaCache.Remove(entry);
            total -= entry.SizeBytes;
            evicted++;
        }

        await db.SaveChangesAsync(cancellationToken);
        if (evicted > 0)
            logger.LogInformation("Evicted {Count} cached media blobs to fit the {Budget} MB budget",
                evicted, budgetBytes / (1024 * 1024));
    }

    private void RemoveFile(MediaCacheEntry entry)
    {
        var fullPath = Path.Combine(rootDirectory, entry.FilePath);
        try
        {
            if (File.Exists(fullPath))
                File.Delete(fullPath);
        }
        catch (IOException e)
        {
            logger.LogWarning(e, "Could not delete the media file for {Key}; the ledger row is removed anyway", entry.Key);
        }
    }
}
