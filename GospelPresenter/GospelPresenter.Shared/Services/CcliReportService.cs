using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

/// <summary>One song display recorded while a device was offline, pushed on its next sync.</summary>
public record CcliSyncEntry(string SongId, string SongName, string CcliNumber,
    string? PresentationId, string PresentationName, DateOnly Date);

public interface ICcliReportService
{
    Task RecordSongDisplayAsync(string organizationId, string songId, string songName, string ccliNumber,
        string? presentationId, string? presentationName);
    Task<int> RecordEntriesAsync(string organizationId, IReadOnlyList<CcliSyncEntry> entries, CallerContext caller);
    Task<List<CcliReportEntry>> GetEntriesAsync(string organizationId, CallerContext caller, bool? reported = null, int skip = 0, int take = 50);
    Task SetReportedBatchAsync(IEnumerable<string> ids, bool reported, string organizationId, CallerContext caller);
    Task<bool> IsCollectionEnabledAsync(string organizationId);
}

public class CcliReportService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    ILogger<CcliReportService> logger) : ICcliReportService
{
    public async Task RecordSongDisplayAsync(string organizationId, string songId, string songName, string ccliNumber,
        string? presentationId, string? presentationName)
    {
        try
        {
            if (!await IsCollectionEnabledAsync(organizationId))
                return;

            await using var context = await dbContextFactory.CreateDbContextAsync();
            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            var exists = await context.CcliReportEntries.AnyAsync(e =>
                e.OrganizationId == organizationId && e.SongId == songId && e.Date == today && e.PresentationId == presentationId);

            if (exists) return;

            context.CcliReportEntries.Add(new CcliReportEntry
            {
                OrganizationId = organizationId,
                SongId = songId,
                SongName = songName,
                CcliNumber = ccliNumber,
                PresentationId = presentationId,
                PresentationName = presentationName ?? "",
                Date = today
            });

            await context.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Unique constraint violation — another session already recorded this song today
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to record CCLI song display for org {OrgId}, song {SongId}", organizationId, songId);
        }
    }

    /// <summary>
    /// Records song displays that happened while a device was offline. Unlike
    /// <see cref="RecordSongDisplayAsync"/> the date comes from the client — the display happened
    /// on the day the projector ran, not on the day the device got back online. Losing these
    /// entries would silently break licence reporting, so re-pushes are idempotent: the unique
    /// (org, song, date, presentation) index and the exists-check make duplicates no-ops.
    /// </summary>
    public async Task<int> RecordEntriesAsync(string organizationId, IReadOnlyList<CcliSyncEntry> entries, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);

        if (entries.Count == 0) return 0;
        if (!await IsCollectionEnabledAsync(organizationId)) return 0;

        var recorded = 0;
        foreach (var entry in entries)
        {
            ValidationHelper.RequireMaxLength(entry.SongName, AppConstraints.NameMaxLength, "SongName");
            ValidationHelper.RequireMaxLength(entry.CcliNumber, AppConstraints.SongCcliMaxLength, "CcliNumber");
            ValidationHelper.RequireMaxLength(entry.PresentationName, AppConstraints.NameMaxLength, "PresentationName");

            try
            {
                // One save per entry so a duplicate (unique index) only skips that entry.
                await using var context = await dbContextFactory.CreateDbContextAsync();
                var exists = await context.CcliReportEntries.AnyAsync(e =>
                    e.OrganizationId == organizationId && e.SongId == entry.SongId
                    && e.Date == entry.Date && e.PresentationId == entry.PresentationId);
                if (exists) continue;

                context.CcliReportEntries.Add(new CcliReportEntry
                {
                    OrganizationId = organizationId,
                    SongId = entry.SongId,
                    SongName = entry.SongName,
                    CcliNumber = entry.CcliNumber,
                    PresentationId = entry.PresentationId,
                    PresentationName = entry.PresentationName,
                    Date = entry.Date
                });
                await context.SaveChangesAsync();
                recorded++;
            }
            catch (DbUpdateException)
            {
                // Unique constraint violation — another device already reported this display.
            }
        }

        return recorded;
    }

    public async Task<List<CcliReportEntry>> GetEntriesAsync(string organizationId, CallerContext caller, bool? reported = null, int skip = 0, int take = 50)
    {
        caller.RequirePermission(Permission.ViewCcliReport);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await BuildQuery(context, organizationId, reported)
            .OrderByDescending(e => e.Date)
            .ThenBy(e => e.PresentationName)
            .ThenBy(e => e.SongName)
            .Skip(skip)
            .Take(take)
            .ToListAsync();
    }

    public async Task SetReportedBatchAsync(IEnumerable<string> ids, bool reported, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageCcliReport);
        caller.RequireOrganizationAccess(organizationId);

        var idList = ids.ToList();
        if (idList.Count == 0) return;

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.CcliReportEntries
            .Where(e => e.OrganizationId == organizationId && idList.Contains(e.Id))
            .ExecuteUpdateAsync(s => s
                .SetProperty(e => e.Reported, reported)
                .SetProperty(e => e.ReportedAt, reported ? DateTime.UtcNow : (DateTime?)null));
    }

    private static IQueryable<CcliReportEntry> BuildQuery(PresentationContext context, string organizationId, bool? reported)
    {
        var query = context.CcliReportEntries
            .Where(e => e.OrganizationId == organizationId);

        if (reported.HasValue)
            query = query.Where(e => e.Reported == reported.Value);

        return query;
    }

    public async Task<bool> IsCollectionEnabledAsync(string organizationId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var setting = await context.OrganizationSettings
            .FirstOrDefaultAsync(s => s.OrganizationId == organizationId && s.Key == OrganizationSetting.CcliCollectionEnabled);
        return setting?.Value == "true";
    }
}
