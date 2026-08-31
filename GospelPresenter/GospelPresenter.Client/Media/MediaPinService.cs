using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Media;

/// <summary>
/// Keeps the blobs presenting offline needs on the device. The pin set is derived, never stored:
/// every image, audio file and slide page referenced by any local presentation, every overlay
/// image, and every library thumbnail (small, and they keep the pickers usable offline). After
/// each sync the set is recomputed from the fresh metadata, missing blobs are downloaded, blobs
/// that fell out of the set become evictable, and the cache is trimmed to its budget.
/// </summary>
public class MediaPinService(
    IDbContextFactory<ClientDataContext> contextFactory,
    MediaStore store,
    IMediaDownloader downloader,
    DeviceAuthService auth,
    ILogger<MediaPinService> logger)
{
    public async Task ReconcileAsync(CancellationToken cancellationToken = default)
    {
        var organizationId = auth.CurrentIdentity?.OrganizationId;
        if (organizationId is null)
            return;

        var wanted = await ComputeWantedKeysAsync(organizationId, cancellationToken);
        await store.ApplyPinsAsync(wanted, cancellationToken);

        var known = await store.GetKnownKeysAsync(cancellationToken);
        var missing = wanted.Where(key => !known.Contains(key)).ToList();
        var downloaded = 0;
        foreach (var key in missing)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var blob = await downloader.DownloadAsync(key, cancellationToken);
            if (blob is null)
                continue;
            await store.SaveAsync(key, blob.Value.Data, blob.Value.ContentType,
                MediaCacheState.Cached, pinned: true, cancellationToken);
            downloaded++;
        }

        if (downloaded > 0)
            logger.LogInformation("Downloaded {Downloaded} of {Missing} missing pinned media blobs", downloaded, missing.Count);

        await store.EvictOverBudgetAsync(MediaStore.DefaultBudgetBytes, cancellationToken);
    }

    private async Task<HashSet<string>> ComputeWantedKeysAsync(string organizationId, CancellationToken cancellationToken)
    {
        await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
        var wanted = new HashSet<string>();

        var referenced = await db.PresentationItems.AsNoTracking()
            .Where(i => i.SourceId != null &&
                        (i.Type == PresentationItemType.Image
                         || i.Type == PresentationItemType.Audio
                         || i.Type == PresentationItemType.Slides))
            .Select(i => new { i.Type, i.SourceId })
            .Distinct()
            .ToListAsync(cancellationToken);

        // Library thumbnails ride along in full: they are small and keep the pickers browsable.
        var imageIds = (await db.OrganizationImages.AsNoTracking().Select(i => i.Id).ToListAsync(cancellationToken)).ToHashSet();
        foreach (var imageId in imageIds)
            wanted.Add(ImageUrlHelper.OrgImageKey(organizationId, imageId, "thumb"));
        foreach (var item in referenced.Where(i => i.Type == PresentationItemType.Image && imageIds.Contains(i.SourceId!)))
            wanted.Add(ImageUrlHelper.OrgImageKey(organizationId, item.SourceId!, "full"));

        var audioIds = (await db.OrganizationAudios.AsNoTracking().Select(a => a.Id).ToListAsync(cancellationToken)).ToHashSet();
        foreach (var item in referenced.Where(i => i.Type == PresentationItemType.Audio && audioIds.Contains(i.SourceId!)))
            wanted.Add(ImageUrlHelper.OrgAudioKey(organizationId, item.SourceId!));

        var slideIds = referenced.Where(i => i.Type == PresentationItemType.Slides).Select(i => i.SourceId!).ToList();
        var decks = await db.PresentationSlides.AsNoTracking()
            .Where(s => slideIds.Contains(s.Id))
            .Select(s => new { s.Id, s.PageCount })
            .ToListAsync(cancellationToken);
        foreach (var deck in decks)
        {
            for (var page = 0; page < deck.PageCount; page++)
                wanted.Add(ImageUrlHelper.SlidesPageKey(organizationId, deck.Id, page));
        }

        var overlayIds = await db.OverlaySlides.AsNoTracking()
            .Where(o => o.HasImage)
            .Select(o => o.Id)
            .ToListAsync(cancellationToken);
        foreach (var overlayId in overlayIds)
            wanted.Add(ImageUrlHelper.OverlayImageKey(organizationId, overlayId));

        return wanted;
    }
}
