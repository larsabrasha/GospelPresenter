using GospelPresenter.Shared.Models;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

/// <summary>What kind of thing a trash entry is. Decides which service restores or purges it.</summary>
public enum TrashKind
{
    Presentation,
    Template,
    Song,
    Image,
    Audio
}

/// <summary>
/// One row in the trash, whatever it used to be. The type-specific fields are carried raw rather
/// than pre-formatted: the weekday of a template's slot has to be localised, and a service has no
/// localizer.
/// </summary>
public record TrashEntry(
    TrashKind Kind,
    string Id,
    string Name,
    DateTimeOffset DeletedAt,
    int DaysRemaining,
    string? Author = null,
    DateOnly? EventDate = null,
    int? ScheduledDayOfWeek = null,
    TimeOnly? ScheduledTime = null,
    string? Location = null);

public interface ITrashService
{
    /// <summary>
    /// Everything in this organisation's trash that the caller can actually act on, newest first.
    /// Kinds the caller has no permission for are left out rather than refused.
    /// </summary>
    Task<IReadOnlyList<TrashEntry>> GetAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);

    Task RestoreAsync(TrashKind kind, string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task PurgeAsync(TrashKind kind, string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>Purges everything the caller is allowed to purge. Kinds they cannot are left alone.</summary>
    Task EmptyAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
}

/// <summary>
/// The one trash.
///
/// Each kind of thing keeps its own trash in its own service — that is where the permission checks,
/// the purge and the retention window belong. This service only gathers them into a single list and
/// routes a restore back to the right one.
///
/// It exists because five trashes in five places is not a feature a volunteer can use. Someone who
/// has just deleted the wrong thing knows only that they deleted something; asking them which kind
/// of thing it was, so they can pick the right page, is asking the question they came to ask.
/// </summary>
public class TrashService(
    IPresentationService presentations,
    ISongService songs,
    IOrganizationImageService images,
    IOrganizationAudioService audios,
    ILogger<TrashService>? logger = null) : ITrashService
{
    public async Task<IReadOnlyList<TrashEntry>> GetAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);

        // Retention is enforced here rather than inside each listing, and before gathering so that
        // an expired row is never shown at all. It is best-effort: purging clears object storage,
        // and storage being unreachable must not stop anyone from *looking* at the trash. A row
        // that outlives its window because a purge failed is harmless; a trash nobody can open is
        // not.
        await PurgeExpiredAsync(organizationId, caller, cancellationToken);

        // Gated on the Manage permission, not View, because every row here carries a Restore and a
        // Delete-permanently button and both of those need Manage. Listing on View would show an
        // ordinary user the template trash — they have ViewTemplates but not ManageTemplates — with
        // two buttons that can only ever fail. It would also make "Empty trash" count rows it then
        // silently skips.
        var entries = new List<TrashEntry>();

        if (caller.HasPermission(Permission.ManagePresentations))
        {
            foreach (var p in await presentations.GetTrashedPresentationsAsync(organizationId, caller, cancellationToken))
                entries.Add(new TrashEntry(TrashKind.Presentation, p.Id, p.Name, p.DeletedAt, p.DaysRemaining, EventDate: p.EventDate));
        }

        if (caller.HasPermission(Permission.ManageTemplates))
        {
            foreach (var t in await presentations.GetTrashedTemplatesAsync(organizationId, caller, cancellationToken))
                entries.Add(new TrashEntry(TrashKind.Template, t.Id, t.Name, t.DeletedAt, t.DaysRemaining,
                    ScheduledDayOfWeek: t.ScheduledDayOfWeek, ScheduledTime: t.ScheduledTime, Location: t.Location));
        }

        if (caller.HasPermission(Permission.ManageSongs))
        {
            foreach (var s in await songs.GetTrashedSongsAsync(organizationId, caller))
                entries.Add(new TrashEntry(TrashKind.Song, s.Id, s.Name, s.DeletedAt, s.DaysRemaining, Author: s.Author));
        }

        if (caller.HasPermission(Permission.ManageOrganizationImages))
        {
            foreach (var i in await images.GetTrashedImagesAsync(organizationId, caller, cancellationToken))
                entries.Add(new TrashEntry(TrashKind.Image, i.Id, i.FileName, i.DeletedAt, i.DaysRemaining));
        }

        if (caller.HasPermission(Permission.ManageOrganizationAudios))
        {
            foreach (var a in await audios.GetTrashedAudiosAsync(organizationId, caller, cancellationToken))
                entries.Add(new TrashEntry(TrashKind.Audio, a.Id, a.FileName, a.DeletedAt, a.DaysRemaining));
        }

        // Newest first, then by id so the order is total: two things deleted in the same tick would
        // otherwise be free to swap places between two renders.
        return entries
            .OrderByDescending(e => e.DeletedAt)
            .ThenBy(e => e.Id, StringComparer.Ordinal)
            .ToList();
    }

    public Task RestoreAsync(TrashKind kind, string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default) =>
        kind switch
        {
            TrashKind.Presentation => presentations.RestorePresentationAsync(organizationId, id, caller, cancellationToken),
            TrashKind.Template => presentations.RestoreTemplateAsync(organizationId, id, caller, cancellationToken),
            TrashKind.Song => songs.RestoreFromTrashAsync(id, organizationId, caller),
            TrashKind.Image => images.RestoreImageAsync(id, organizationId, caller, cancellationToken),
            TrashKind.Audio => audios.RestoreAudioAsync(id, organizationId, caller, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };

    public Task PurgeAsync(TrashKind kind, string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default) =>
        kind switch
        {
            TrashKind.Presentation => presentations.PermanentlyDeletePresentationAsync(organizationId, id, caller, cancellationToken),
            TrashKind.Template => presentations.PermanentlyDeleteTemplateAsync(organizationId, id, caller, cancellationToken),
            TrashKind.Song => songs.PermanentlyDeleteSongAsync(id, organizationId, caller),
            TrashKind.Image => images.PermanentlyDeleteImageAsync(id, organizationId, caller, cancellationToken),
            TrashKind.Audio => audios.PermanentlyDeleteAudioAsync(id, organizationId, caller, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };

    /// <summary>
    /// Best-effort retention sweep across every kind the caller may manage. Each failure is logged
    /// and stepped over: this runs on the read path, where the caller asked to see the trash and not
    /// to tidy it.
    /// </summary>
    private async Task PurgeExpiredAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken)
    {
        await TryPurgeAsync(Permission.ManagePresentations, nameof(TrashKind.Presentation),
            () => presentations.PurgeExpiredPresentationsAsync(organizationId, caller, cancellationToken));
        await TryPurgeAsync(Permission.ManageTemplates, nameof(TrashKind.Template),
            () => presentations.PurgeExpiredTemplatesAsync(organizationId, caller, cancellationToken));
        await TryPurgeAsync(Permission.ManageOrganizationImages, nameof(TrashKind.Image),
            () => images.PurgeExpiredImagesAsync(organizationId, caller, cancellationToken));
        await TryPurgeAsync(Permission.ManageOrganizationAudios, nameof(TrashKind.Audio),
            () => audios.PurgeExpiredAudiosAsync(organizationId, caller, cancellationToken));

        // Songs have no lazy purge of their own: SongService sweeps them when it loads its cache.

        async Task TryPurgeAsync(Permission permission, string kind, Func<Task> purge)
        {
            if (!caller.HasPermission(permission)) return;
            try
            {
                await purge();
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Retention purge of {Kind} failed for organisation {OrganizationId}; " +
                    "the trash is still readable and the sweep will be retried next time it is opened",
                    kind, organizationId);
            }
        }
    }

    public async Task EmptyAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);

        // The permission checks match GetAsync's exactly, so this clears everything the caller was
        // shown and nothing is skipped behind their back.
        //
        // Each of these is its own transaction. A failure part-way through leaves the rest of the
        // trash intact, which is the safe direction: the caller can look at what is left and try
        // again, whereas one big transaction across five services would roll back purges that
        // already cleared their files from object storage.
        if (caller.HasPermission(Permission.ManagePresentations))
            await presentations.EmptyPresentationTrashAsync(organizationId, caller, cancellationToken);

        if (caller.HasPermission(Permission.ManageTemplates))
            await presentations.EmptyTemplateTrashAsync(organizationId, caller, cancellationToken);

        if (caller.HasPermission(Permission.ManageSongs))
            await songs.EmptyTrashAsync(organizationId, caller);

        if (caller.HasPermission(Permission.ManageOrganizationImages))
            await images.EmptyImageTrashAsync(organizationId, caller, cancellationToken);

        if (caller.HasPermission(Permission.ManageOrganizationAudios))
            await audios.EmptyAudioTrashAsync(organizationId, caller, cancellationToken);
    }
}
