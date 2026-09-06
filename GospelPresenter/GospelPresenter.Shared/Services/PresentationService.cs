using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public record DashboardPresentations(
    IList<PresentationSummary> Today,
    IList<PresentationSummary> Upcoming);

public record PresentationSummaryPage(
    IReadOnlyList<PresentationSummary> Items,
    int TotalCount);

/// <summary>A presentation in the trash, and how long it has left there.</summary>
public record TrashedPresentation(string Id, string Name, DateOnly? EventDate, DateTimeOffset DeletedAt)
{
    public int DaysRemaining => TrashRetention.DaysRemaining(DeletedAt);
}

/// <summary>
/// A template in the trash. Its own record rather than a reuse of <see cref="TrashedPresentation"/>:
/// a template has no event date but a weekly slot, and that slot is what tells two similarly named
/// templates apart in the list.
/// </summary>
public record TrashedTemplate(
    string Id, string Name, int? ScheduledDayOfWeek, TimeOnly? ScheduledTime, string? Location,
    DateTimeOffset DeletedAt)
{
    public int DaysRemaining => TrashRetention.DaysRemaining(DeletedAt);
}

internal static class TrashRetention
{
    public static int DaysRemaining(DateTimeOffset deletedAt) =>
        Math.Max(0, AppConstraints.TrashRetentionDays - (int)(DateTimeOffset.UtcNow - deletedAt).TotalDays);
}

public interface IPresentationService
{
    Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<DashboardPresentations> GetDashboardPresentationsAsync(string organizationId, DateOnly today, CallerContext caller, CancellationToken cancellationToken = default);
    /// <summary>
    /// One page of the organisation's presentations, most recently changed first.
    /// <paramref name="eventDateBefore"/> keeps only those dated before it, plus the undated ones —
    /// the dashboard passes today so its own Today and Upcoming sections are not repeated in the
    /// list below them.
    /// </summary>
    Task<PresentationSummaryPage> GetPresentationSummariesPageAsync(string organizationId, int skip, int take, CallerContext caller, DateOnly? eventDateBefore = null, CancellationToken cancellationToken = default);
    Task<Presentation?> GetPresentationByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation?> GetTemplateByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CallerContext caller, DateOnly? eventDate = null, TimeOnly? eventTime = null, string? eventLocation = null, string? description = null, CancellationToken cancellationToken = default);
    Task AddItemAsync(string organizationId, string presentationId, PresentationItem item, CallerContext caller, CancellationToken cancellationToken = default);
    Task RenamePresentationAsync(string organizationId, string id, string name, CallerContext caller, CancellationToken cancellationToken = default);
    Task ReorderItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default);
    Task RenameItemAsync(string organizationId, string presentationId, string itemId, string title, CallerContext caller, CancellationToken cancellationToken = default);
    Task UpdateItemArrangementAsync(string organizationId, string presentationId, string itemId, string? arrangementId, CallerContext caller, CancellationToken cancellationToken = default);
    Task AddItemPartsAsync(string organizationId, string presentationId, string itemId, List<PresentationItemPart> parts, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveItemPartAsync(string organizationId, string presentationId, string itemId, string partId, CallerContext caller, CancellationToken cancellationToken = default);
    Task ReorderItemPartsAsync(string organizationId, string presentationId, string itemId, List<string> partIds, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveItemAsync(string organizationId, string presentationId, string itemId, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default);
    Task SaveAsync(string organizationId, Presentation presentation, CallerContext caller, CancellationToken cancellationToken = default);
    /// <summary>Moves a presentation to the trash. Reversible until it is purged.</summary>
    Task DeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>The organisation's trashed presentations, newest first. Purges what has expired first.</summary>
    Task<IList<TrashedPresentation>> GetTrashedPresentationsAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task RestorePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task PermanentlyDeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task EmptyPresentationTrashAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>Purges what has been in the trash past the retention window. Safe to call at any time.</summary>
    Task PurgeExpiredPresentationsAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>The organisation's trashed templates, newest first. Purges what has expired first.</summary>
    Task<IList<TrashedTemplate>> GetTrashedTemplatesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task RestoreTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task PermanentlyDeleteTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task EmptyTemplateTrashAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task PurgeExpiredTemplatesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<IList<PresentationSummary>> GetRecentTemplateSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<IList<PresentationSummary>> GetAllTemplateSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation> SaveAsTemplateAsync(string presentationId, string name, string organizationId, string userId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation> CreatePresentationFromTemplateAsync(string templateId, string name, string organizationId, string userId, CallerContext caller, DateOnly? eventDate = null, TimeOnly? eventTime = null, string? eventLocation = null, string? description = null, CancellationToken cancellationToken = default);
    Task<Presentation> CreateTemplateAsync(string name, string organizationId, string userId, CallerContext caller, int? scheduledDayOfWeek = null, TimeOnly? scheduledTime = null, string? location = null, CancellationToken cancellationToken = default);
    Task UpdateTemplateScheduleAsync(string organizationId, string templateId, int? dayOfWeek, TimeOnly? time, string? location, CallerContext caller, CancellationToken cancellationToken = default);
    Task UpdatePresentationEventAsync(string organizationId, string presentationId, DateOnly? date, TimeOnly? time, string? location, string? description, CallerContext caller, CancellationToken cancellationToken = default);

    /// <summary>Sets or clears the presentation's theme. Null means it follows the organisation's default.</summary>
    Task UpdatePresentationThemeAsync(string organizationId, string presentationId, string? themeId, CallerContext caller, CancellationToken cancellationToken = default);
    /// <summary>Moves a template to the trash. Reversible until it is purged.</summary>
    Task DeleteTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task<List<OverlaySlide>> GetOverlaysAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OverlaySlide?> GetOverlayByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task AddOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default);
    Task UpdateOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveOverlayAsync(string organizationId, string overlayId, CallerContext caller, CancellationToken cancellationToken = default);
}

public class PresentationService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    IObjectStorageService storage,
    // Announces changes made through ExecuteUpdateAsync, which reaches no change tracker and so is
    // invisible to the interceptor that announces ordinary saves — the same reason those call sites
    // have to stamp ModifiedAt by hand. Optional so the many tests that build this service directly
    // stay unchanged; the container always has at least the null implementation.
    IOrganizationChangeNotifier? changeNotifier = null) : IPresentationService
{
    public async Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var presentations = await context.Presentations
            .NotDeleted()
            .Where(x => x.OrganizationId == organizationId && !x.IsTemplate)
            .OrderByDescending(x => x.UpdatedAt)
            .Take(20)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt))
            .ToListAsync(cancellationToken);

        return presentations;
    }

    public async Task<DashboardPresentations> GetDashboardPresentationsAsync(string organizationId, DateOnly today, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var orgPresentations = context.Presentations
            .NotDeleted()
            .Where(x => x.OrganizationId == organizationId && !x.IsTemplate);

        var todayList = await orgPresentations
            .Where(x => x.EventDate == today)
            .OrderBy(x => x.EventTime ?? TimeOnly.MaxValue)
            .ThenByDescending(x => x.UpdatedAt)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt) { Location = x.EventLocation, EventDate = x.EventDate, EventTime = x.EventTime })
            .ToListAsync(cancellationToken);

        // Uncapped, like today's. The list below these sections holds only what is dated before
        // today or not dated at all, so anything cut off here would be shown nowhere.
        var upcomingList = await orgPresentations
            .Where(x => x.EventDate > today)
            .OrderBy(x => x.EventDate)
            .ThenBy(x => x.EventTime ?? TimeOnly.MaxValue)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt) { Location = x.EventLocation, EventDate = x.EventDate, EventTime = x.EventTime })
            .ToListAsync(cancellationToken);

        // Everything else the dashboard shows comes from the paged list below these two sections,
        // which counts the rest for itself.
        return new DashboardPresentations(todayList, upcomingList);
    }

    public async Task<PresentationSummaryPage> GetPresentationSummariesPageAsync(string organizationId, int skip, int take, CallerContext caller, DateOnly? eventDateBefore = null, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);

        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 1, 200);

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var query = context.Presentations
            .NotDeleted()
            .Where(x => x.OrganizationId == organizationId && !x.IsTemplate);

        if (eventDateBefore is { } cutoff)
            query = query.Where(x => x.EventDate == null || x.EventDate < cutoff);

        var total = await query.CountAsync(cancellationToken);

        // Last changed first, dated and undated alike. Ordering by the event date instead would read
        // better for services, but it has nowhere to put a presentation with no date: appended to
        // either end it is either always on top or buried behind every past service, and the one you
        // just made and never dated is exactly the one you are looking for. Coalescing the two —
        // event date, falling back to the day it was last changed — is what this wants to say, but
        // no SQLite provider translates that expression, and this same query runs on the desktop
        // app's local database. A stored sort column would be the way to say it, at the price of a
        // migration and one more field to keep in step on every write.
        //
        // Id last, so the order is total: two presentations saved in the same tick would otherwise
        // be free to swap places between two pages and so be shown twice, or not at all.
        var ordered = query
            .OrderByDescending(x => x.UpdatedAt)
            .ThenBy(x => x.Id);

        var items = await ordered
            .Skip(skip)
            .Take(take)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt) { Location = x.EventLocation, EventDate = x.EventDate, EventTime = x.EventTime })
            .ToListAsync(cancellationToken);

        return new PresentationSummaryPage(items, total);
    }

    public async Task<Presentation?> GetPresentationByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        return await GetByIdAsync(id, organizationId, isTemplate: false, cancellationToken);
    }

    public async Task<Presentation?> GetTemplateByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewTemplates);
        caller.RequireOrganizationAccess(organizationId);
        return await GetByIdAsync(id, organizationId, isTemplate: true, cancellationToken);
    }

    private async Task<Presentation?> GetByIdAsync(string id, string organizationId, bool isTemplate, CancellationToken cancellationToken)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.Presentations
            .NotDeleted()
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
                .ThenInclude(x => x.Parts.OrderBy(p => p.SortOrder))
            .Where(x => x.Id == id && x.OrganizationId == organizationId && x.IsTemplate == isTemplate)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CallerContext caller, DateOnly? eventDate = null, TimeOnly? eventTime = null, string? eventLocation = null, string? description = null, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(eventLocation, AppConstraints.LocationMaxLength, "Location");
        ValidationHelper.RequireMaxLength(description, AppConstraints.DescriptionMaxLength, "Description");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        // The trash does not count against the quota: a presentation the user believes is gone
        // must not be what stops them creating the next one.
        await ValidationHelper.RequireMaxCountAsync(
            context.Presentations.NotDeleted().Where(x => x.OrganizationId == organizationId && !x.IsTemplate),
            AppConstraints.MaxPresentationsPerOrg, "presentations", cancellationToken);

        var organization = await context.Organizations.FindAsync([organizationId], cancellationToken);
        if (organization is null)
        {
            organization = new Organization { Id = organizationId, Name = "Default" };
            context.Organizations.Add(organization);
        }

        var now = DateTimeOffset.UtcNow;
        var presentation = new Presentation
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            OrganizationId = organizationId,
            EventDate = eventDate,
            EventTime = eventTime,
            EventLocation = eventLocation,
            Description = description,
            CreatedAt = now,
            CreatedBy = userId,
            UpdatedAt = now,
            UpdatedBy = userId
        };

        context.Presentations.Add(presentation);
        await context.SaveChangesAsync(cancellationToken);

        return presentation;
    }

    public async Task AddItemAsync(string organizationId, string presentationId, PresentationItem item, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(item.Title, AppConstraints.NameMaxLength, "Title");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // RequireOrganizationAccess only proves the caller owns organizationId; it does not prove
        // the target presentation does. Verify the presentation belongs to the org before inserting,
        // otherwise a caller could add items to another organization's presentation by its id.
        var presentationExists = await context.Presentations
            .NotDeleted()
            .AnyAsync(p => p.Id == presentationId && p.OrganizationId == organizationId, cancellationToken);
        if (!presentationExists) throw new InvalidOperationException("Presentation not found.");

        await ValidationHelper.RequireMaxCountAsync(
            context.PresentationItems.Where(x => x.PresentationId == presentationId),
            AppConstraints.MaxItemsPerPresentation, "items", cancellationToken);

        item.PresentationId = presentationId;

        var maxSortOrder = await context.PresentationItems
            .Where(x => x.PresentationId == presentationId)
            .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

        item.SortOrder = maxSortOrder + 1;

        context.PresentationItems.Add(item);

        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RenamePresentationAsync(string organizationId, string id, string name, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.Presentations
            .NotDeleted()
            .Where(x => x.Id == id && x.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.Name, name)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        changeNotifier?.Notify(organizationId);
    }

    public async Task ReorderItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var items = await context.PresentationItems
            .Where(x => x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            var newIndex = itemIds.IndexOf(item.Id);
            if (newIndex >= 0)
                item.SortOrder = newIndex;
        }

        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RenameItemAsync(string organizationId, string presentationId, string itemId, string title, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(title, AppConstraints.NameMaxLength, "Title");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.Id == itemId && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.Title, title)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
    }

    public async Task UpdateItemArrangementAsync(string organizationId, string presentationId, string itemId, string? arrangementId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.Id == itemId && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.ArrangementId, arrangementId)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
    }

    public async Task AddItemPartsAsync(string organizationId, string presentationId, string itemId, List<PresentationItemPart> parts, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        foreach (var part in parts)
            ValidationHelper.RequireMaxLength(part.Content, AppConstraints.PresentationItemPartContentMaxLength, "Content");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Verify the target item (and its presentation) belongs to the caller's org before inserting;
        // RequireOrganizationAccess above only validates the caller's own org, not the item's owner.
        var itemExists = await context.PresentationItems
            .AnyAsync(x => x.Id == itemId
                           && x.PresentationId == presentationId
                           && x.Presentation.OrganizationId == organizationId, cancellationToken);
        if (!itemExists) throw new InvalidOperationException("Presentation item not found.");

        var existingCount = await context.PresentationItemParts
            .CountAsync(x => x.PresentationItemId == itemId, cancellationToken);
        if (existingCount + parts.Count > AppConstraints.MaxPartsPerPresentationItem)
            throw new InvalidOperationException($"The maximum number of parts ({AppConstraints.MaxPartsPerPresentationItem}) has been reached.");

        var maxSortOrder = await context.PresentationItemParts
            .Where(x => x.PresentationItemId == itemId && x.PresentationItem.PresentationId == presentationId && x.PresentationItem.Presentation.OrganizationId == organizationId)
            .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

        foreach (var part in parts)
        {
            part.PresentationItemId = itemId;
            part.SortOrder = ++maxSortOrder;
        }

        context.PresentationItemParts.AddRange(parts);
        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RemoveItemPartAsync(string organizationId, string presentationId, string itemId, string partId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Tracked delete rather than ExecuteDelete, so the context writes the tombstone itself.
        var part = await context.PresentationItemParts
            .Where(x => x.Id == partId && x.PresentationItemId == itemId && x.PresentationItem.PresentationId == presentationId && x.PresentationItem.Presentation.OrganizationId == organizationId)
            .FirstOrDefaultAsync(cancellationToken);
        if (part is null) return;

        context.PresentationItemParts.Remove(part);
        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task ReorderItemPartsAsync(string organizationId, string presentationId, string itemId, List<string> partIds, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var parts = await context.PresentationItemParts
            .Where(x => x.PresentationItemId == itemId && x.PresentationItem.PresentationId == presentationId && x.PresentationItem.Presentation.OrganizationId == organizationId)
            .ToListAsync(cancellationToken);

        foreach (var part in parts)
        {
            var newIndex = partIds.IndexOf(part.Id);
            if (newIndex >= 0)
                part.SortOrder = newIndex;
        }

        await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RemoveItemAsync(string organizationId, string presentationId, string itemId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var item = await context.PresentationItems
            .Where(x => x.PresentationId == presentationId && x.Id == itemId && x.Presentation.OrganizationId == organizationId)
            .Select(x => new { x.Type, x.SourceId })
            .FirstOrDefaultAsync(cancellationToken);

        if (item is null) return;

        var isSlides = item.Type == PresentationItemType.Slides && item.SourceId is not null;

        if (isSlides)
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

            await context.PresentationItems
                .Where(x => x.Id == itemId)
                .ExecuteDeleteAsync(cancellationToken);

            await context.PresentationSlides
                .Where(s => s.Id == item.SourceId)
                .ExecuteDeleteAsync(cancellationToken);

            // The item's parts fall with it via the FK cascade; the item tombstone covers them.
            context.AddTombstones(nameof(PresentationItem), [itemId], organizationId);
            context.AddTombstones(nameof(PresentationSlides), [item.SourceId!], organizationId);
            await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, item.SourceId!), cancellationToken);
        }
        else
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

            await context.PresentationItems
                .Where(x => x.Id == itemId)
                .ExecuteDeleteAsync(cancellationToken);

            context.AddTombstones(nameof(PresentationItem), [itemId], organizationId);
            await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
    }

    public async Task RemoveItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // itemIds comes from the client; tombstone only the rows that actually belong here.
        var existingItemIds = await context.PresentationItems
            .Where(x => itemIds.Contains(x.Id) && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        var slidesIds = await context.PresentationItems
            .Where(x => itemIds.Contains(x.Id) && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId
                && x.Type == PresentationItemType.Slides && x.SourceId != null)
            .Select(x => x.SourceId!)
            .ToListAsync(cancellationToken);

        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(p => itemIds.Contains(p.PresentationItemId) && p.PresentationItem.PresentationId == presentationId && p.PresentationItem.Presentation.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => itemIds.Contains(x.Id) && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        if (slidesIds.Count > 0)
        {
            await context.PresentationSlides
                .Where(s => slidesIds.Contains(s.Id))
                .ExecuteDeleteAsync(cancellationToken);
        }

        if (existingItemIds.Count > 0)
        {
            // Parts fall with their items via the FK cascade; the item tombstones cover them.
            context.AddTombstones(nameof(PresentationItem), existingItemIds, organizationId);
            context.AddTombstones(nameof(PresentationSlides), slidesIds, organizationId);
            await BumpPresentationAsync(context, presentationId, organizationId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        foreach (var slidesId in slidesIds)
            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, slidesId), cancellationToken);
    }

    public async Task SaveAsync(string organizationId, Presentation presentation, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(presentation.Name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var existing = await context.Presentations
            .NotDeleted()
            .FirstOrDefaultAsync(x => x.Id == presentation.Id && x.OrganizationId == organizationId, cancellationToken);
        if (existing is null) return;

        existing.Name = presentation.Name;
        existing.UpdatedAt = DateTimeOffset.UtcNow;
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task DeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default) =>
        TrashAsync(organizationId, id, isTemplate: false, Permission.ManagePresentations, caller, cancellationToken);

    public Task DeleteTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default) =>
        TrashAsync(organizationId, id, isTemplate: true, Permission.ManageTemplates, caller, cancellationToken);

    public async Task<IList<TrashedPresentation>> GetTrashedPresentationsAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        return await TrashQuery(context, organizationId, isTemplate: false)
            .Select(x => new TrashedPresentation(x.Id, x.Name, x.EventDate, x.DeletedAt!.Value))
            .ToListAsync(cancellationToken);
    }

    public async Task<IList<TrashedTemplate>> GetTrashedTemplatesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewTemplates);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        return await TrashQuery(context, organizationId, isTemplate: true)
            .Select(x => new TrashedTemplate(x.Id, x.Name, x.ScheduledDayOfWeek, x.ScheduledTime, x.EventLocation, x.DeletedAt!.Value))
            .ToListAsync(cancellationToken);
    }

    public Task RestorePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default) =>
        RestoreAsync(organizationId, id, isTemplate: false, Permission.ManagePresentations, caller, cancellationToken);

    public Task RestoreTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default) =>
        RestoreAsync(organizationId, id, isTemplate: true, Permission.ManageTemplates, caller, cancellationToken);

    public Task PermanentlyDeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default) =>
        PurgeOneAsync(organizationId, id, isTemplate: false, Permission.ManagePresentations, caller, cancellationToken);

    public Task PermanentlyDeleteTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default) =>
        PurgeOneAsync(organizationId, id, isTemplate: true, Permission.ManageTemplates, caller, cancellationToken);

    public Task EmptyPresentationTrashAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default) =>
        PurgeAllAsync(organizationId, isTemplate: false, Permission.ManagePresentations, caller, cancellationToken);

    public Task EmptyTemplateTrashAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default) =>
        PurgeAllAsync(organizationId, isTemplate: true, Permission.ManageTemplates, caller, cancellationToken);

    public Task PurgeExpiredPresentationsAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default) =>
        PurgeExpiredAsync(organizationId, isTemplate: false, Permission.ManagePresentations, caller, cancellationToken);

    public Task PurgeExpiredTemplatesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default) =>
        PurgeExpiredAsync(organizationId, isTemplate: true, Permission.ManageTemplates, caller, cancellationToken);

    // --- The trash, shared by presentations and templates ---
    //
    // Both live in the Presentations table and differ only by IsTemplate and by which permission
    // governs them, so they share one implementation. Keeping them apart in the public API is
    // deliberate: they are separate lists in separate places in the app, and a caller that could
    // pass the wrong flag would empty the wrong trash.

    /// <summary>
    /// Moves a row to the trash. A tracked update, so the save stamps ModifiedAt and announces the
    /// change by itself. No tombstone: the row is still there, and DeletedAt travels to clients as
    /// an ordinary column so every device shows the same trash. The tombstone belongs to the purge.
    /// </summary>
    private async Task TrashAsync(string organizationId, string id, bool isTemplate, Permission permission, CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(permission);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var row = await context.Presentations
            .NotDeleted()
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId && x.IsTemplate == isTemplate, cancellationToken);
        if (row is null) return;

        row.DeletedAt = DateTimeOffset.UtcNow;
        await context.SaveChangesAsync(cancellationToken);
    }

    private async Task RestoreAsync(string organizationId, string id, bool isTemplate, Permission permission, CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(permission);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var row = await context.Presentations
            .OnlyDeleted()
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId && x.IsTemplate == isTemplate, cancellationToken);
        if (row is null) return;

        // Restoring can carry the organisation past its quota — it was under it when the row was
        // trashed, and refusing here would strand the row with nowhere to go.
        row.DeletedAt = null;
        await context.SaveChangesAsync(cancellationToken);
    }

    private async Task PurgeOneAsync(string organizationId, string id, bool isTemplate, Permission permission, CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(permission);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var trashed = await TrashQuery(context, organizationId, isTemplate)
            .Where(x => x.Id == id)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        await PurgeAsync(context, organizationId, trashed, cancellationToken);
    }

    private async Task PurgeAllAsync(string organizationId, bool isTemplate, Permission permission, CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(permission);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var trashed = await TrashQuery(context, organizationId, isTemplate)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        await PurgeAsync(context, organizationId, trashed, cancellationToken);
    }

    private async Task PurgeExpiredAsync(string organizationId, bool isTemplate, Permission permission, CallerContext caller, CancellationToken cancellationToken)
    {
        caller.RequirePermission(permission);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var cutoff = DateTimeOffset.UtcNow.AddDays(-AppConstraints.TrashRetentionDays);
        var expired = await TrashQuery(context, organizationId, isTemplate)
            .Where(x => x.DeletedAt < cutoff)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        await PurgeAsync(context, organizationId, expired, cancellationToken);
    }

    /// <summary>One organisation's trash, newest first.</summary>
    private static IQueryable<Presentation> TrashQuery(PresentationContext context, string organizationId, bool isTemplate) =>
        context.Presentations
            .OnlyDeleted()
            .Where(x => x.OrganizationId == organizationId && x.IsTemplate == isTemplate)
            .OrderByDescending(x => x.DeletedAt);

    /// <summary>
    /// Deletes presentations or templates for good: rows, tombstones and the slide files behind
    /// them. This is what the delete methods used to do on the user's first click, and the only
    /// place that still does it — the caller has already checked that every id is in the trash.
    /// </summary>
    private async Task PurgeAsync(PresentationContext context, string organizationId, List<string> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0) return;

        var slidesIds = await context.PresentationItems
            .Where(x => ids.Contains(x.PresentationId) && x.Presentation.OrganizationId == organizationId
                && x.Type == PresentationItemType.Slides && x.SourceId != null)
            .Select(x => x.SourceId!)
            .ToListAsync(cancellationToken);

        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(p => ids.Contains(p.PresentationItem.PresentationId))
            .ExecuteDeleteAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => ids.Contains(x.PresentationId))
            .ExecuteDeleteAsync(cancellationToken);

        if (slidesIds.Count > 0)
        {
            await context.PresentationSlides
                .Where(s => slidesIds.Contains(s.Id))
                .ExecuteDeleteAsync(cancellationToken);
        }

        var deletedCount = await context.Presentations
            .Where(x => ids.Contains(x.Id) && x.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        if (deletedCount > 0)
        {
            // One tombstone per aggregate root; clients cascade to items, parts and slides.
            context.AddTombstones(nameof(Presentation), ids, organizationId);
            await context.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        foreach (var slidesId in slidesIds)
            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, slidesId), cancellationToken);
    }

    public async Task<IList<PresentationSummary>> GetRecentTemplateSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewTemplates);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.Presentations
            .NotDeleted()
            .Where(x => x.OrganizationId == organizationId && x.IsTemplate)
            .OrderByDescending(x => x.LastUsedAt)
            .ThenByDescending(x => x.UpdatedAt)
            .Take(10)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt, x.ScheduledDayOfWeek, x.ScheduledTime, x.EventLocation))
            .ToListAsync(cancellationToken);
    }

    public async Task<IList<PresentationSummary>> GetAllTemplateSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageTemplates);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.Presentations
            .NotDeleted()
            .Where(x => x.OrganizationId == organizationId && x.IsTemplate)
            .OrderByDescending(x => x.UpdatedAt)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt))
            .ToListAsync(cancellationToken);
    }

    public async Task<Presentation> CreateTemplateAsync(string name, string organizationId, string userId, CallerContext caller, int? scheduledDayOfWeek = null, TimeOnly? scheduledTime = null, string? location = null, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageTemplates);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(location, AppConstraints.LocationMaxLength, "Location");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await ValidationHelper.RequireMaxCountAsync(
            context.Presentations.NotDeleted().Where(x => x.OrganizationId == organizationId && x.IsTemplate),
            AppConstraints.MaxTemplatesPerOrg, "templates", cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var template = new Presentation
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            IsTemplate = true,
            OrganizationId = organizationId,
            ScheduledDayOfWeek = scheduledDayOfWeek,
            ScheduledTime = scheduledTime,
            EventLocation = location,
            CreatedAt = now,
            CreatedBy = userId,
            UpdatedAt = now,
            UpdatedBy = userId
        };

        context.Presentations.Add(template);
        await context.SaveChangesAsync(cancellationToken);

        return template;
    }

    public async Task<Presentation> SaveAsTemplateAsync(string presentationId, string name, string organizationId, string userId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageTemplates);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await ValidationHelper.RequireMaxCountAsync(
            context.Presentations.NotDeleted().Where(x => x.OrganizationId == organizationId && x.IsTemplate),
            AppConstraints.MaxTemplatesPerOrg, "templates", cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var source = await context.Presentations
            .NotDeleted()
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
                .ThenInclude(x => x.Parts.OrderBy(p => p.SortOrder))
            .FirstOrDefaultAsync(x => x.Id == presentationId && x.OrganizationId == organizationId && !x.IsTemplate, cancellationToken);

        if (source is null)
            throw new InvalidOperationException("Presentation not found.");

        var now = DateTimeOffset.UtcNow;
        var template = new Presentation
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            IsTemplate = true,
            OrganizationId = organizationId,
            // Saving a presentation as a template captures its look along with its items.
            ThemeId = source.ThemeId,
            CreatedAt = now,
            CreatedBy = userId,
            UpdatedAt = now,
            UpdatedBy = userId
        };

        context.Presentations.Add(template);

        foreach (var sourceItem in source.Items)
        {
            var newItem = new PresentationItem
            {
                Id = Guid.NewGuid().ToString(),
                SourceId = sourceItem.SourceId,
                Type = sourceItem.Type,
                Title = sourceItem.Title,
                SortOrder = sourceItem.SortOrder,
                PresentationId = template.Id
            };
            context.PresentationItems.Add(newItem);

            foreach (var sourcePart in sourceItem.Parts)
            {
                context.PresentationItemParts.Add(new PresentationItemPart
                {
                    Id = Guid.NewGuid().ToString(),
                    Content = sourcePart.Content,
                    SortOrder = sourcePart.SortOrder,
                    PresentationItemId = newItem.Id
                });
            }
        }

        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return template;
    }

    public async Task<Presentation> CreatePresentationFromTemplateAsync(string templateId, string name, string organizationId, string userId, CallerContext caller, DateOnly? eventDate = null, TimeOnly? eventTime = null, string? eventLocation = null, string? description = null, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequirePermission(Permission.ViewTemplates);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        ValidationHelper.RequireMaxLength(eventLocation, AppConstraints.LocationMaxLength, "Location");
        ValidationHelper.RequireMaxLength(description, AppConstraints.DescriptionMaxLength, "Description");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await ValidationHelper.RequireMaxCountAsync(
            context.Presentations.NotDeleted().Where(x => x.OrganizationId == organizationId && !x.IsTemplate),
            AppConstraints.MaxPresentationsPerOrg, "presentations", cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var template = await context.Presentations
            .NotDeleted()
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
                .ThenInclude(x => x.Parts.OrderBy(p => p.SortOrder))
            .FirstOrDefaultAsync(x => x.Id == templateId && x.OrganizationId == organizationId && x.IsTemplate, cancellationToken);

        if (template is null)
            throw new InvalidOperationException("Template not found.");

        var now = DateTimeOffset.UtcNow;
        var presentation = new Presentation
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            OrganizationId = organizationId,
            EventDate = eventDate,
            EventTime = eventTime,
            EventLocation = eventLocation,
            Description = description,
            // The theme is part of the template's design: a Christmas template keeps its look.
            ThemeId = template.ThemeId,
            CreatedAt = now,
            CreatedBy = userId,
            UpdatedAt = now,
            UpdatedBy = userId
        };

        context.Presentations.Add(presentation);

        var templateSlidesIds = template.Items
            .Where(i => i.Type == PresentationItemType.Slides && i.SourceId is not null)
            .Select(i => i.SourceId!)
            .ToList();

        var slidesBySourceId = templateSlidesIds.Count > 0
            ? await context.PresentationSlides
                .Where(s => templateSlidesIds.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, cancellationToken)
            : [];

        var slidesToCopy = new List<(string OldId, string NewId)>();

        foreach (var sourceItem in template.Items)
        {
            string? newSourceId = sourceItem.SourceId;

            if (sourceItem.Type == PresentationItemType.Slides && sourceItem.SourceId is not null
                && slidesBySourceId.TryGetValue(sourceItem.SourceId, out var templateSlides))
            {
                var newSlides = new PresentationSlides
                {
                    FileName = templateSlides.FileName,
                    PageCount = templateSlides.PageCount,
                    PresentationId = presentation.Id
                };
                context.PresentationSlides.Add(newSlides);
                slidesToCopy.Add((sourceItem.SourceId, newSlides.Id));
                newSourceId = newSlides.Id;
            }

            var newItem = new PresentationItem
            {
                Id = Guid.NewGuid().ToString(),
                SourceId = newSourceId,
                Type = sourceItem.Type,
                Title = sourceItem.Title,
                SortOrder = sourceItem.SortOrder,
                PresentationId = presentation.Id
            };
            context.PresentationItems.Add(newItem);

            foreach (var sourcePart in sourceItem.Parts)
            {
                context.PresentationItemParts.Add(new PresentationItemPart
                {
                    Id = Guid.NewGuid().ToString(),
                    Content = sourcePart.Content,
                    SortOrder = sourcePart.SortOrder,
                    PresentationItemId = newItem.Id
                });
            }
        }

        template.LastUsedAt = now;
        template.UseCount++;

        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        foreach (var (oldId, newId) in slidesToCopy)
            await storage.CopyByPrefixAsync(
                ImageUrlHelper.SlidesPrefix(organizationId, oldId),
                ImageUrlHelper.SlidesPrefix(organizationId, newId),
                cancellationToken);

        return presentation;
    }

    public async Task UpdateTemplateScheduleAsync(string organizationId, string templateId, int? dayOfWeek, TimeOnly? time, string? location, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageTemplates);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(location, AppConstraints.LocationMaxLength, "Location");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.Presentations
            .NotDeleted()
            .Where(x => x.Id == templateId && x.OrganizationId == organizationId && x.IsTemplate)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.ScheduledDayOfWeek, dayOfWeek)
                .SetProperty(p => p.ScheduledTime, time)
                .SetProperty(p => p.EventLocation, location)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        changeNotifier?.Notify(organizationId);
    }

    public async Task UpdatePresentationEventAsync(string organizationId, string presentationId, DateOnly? date, TimeOnly? time, string? location, string? description, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(location, AppConstraints.LocationMaxLength, "Location");
        ValidationHelper.RequireMaxLength(description, AppConstraints.DescriptionMaxLength, "Description");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.Presentations
            .NotDeleted()
            .Where(x => x.Id == presentationId && x.OrganizationId == organizationId && !x.IsTemplate)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.EventDate, date)
                .SetProperty(p => p.EventTime, time)
                .SetProperty(p => p.EventLocation, location)
                .SetProperty(p => p.Description, description)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        changeNotifier?.Notify(organizationId);
    }

    public async Task UpdatePresentationThemeAsync(string organizationId, string presentationId, string? themeId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequirePermission(Permission.ViewThemes);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // The theme id comes from the client, so it is checked against what this organisation may use.
        // Without this a caller could dress their slides in another organisation's theme.
        if (themeId is not null)
        {
            var usable = await context.Themes
                .AnyAsync(t => t.Id == themeId && (t.OrganizationId == null || t.OrganizationId == organizationId), cancellationToken);
            if (!usable)
                throw new InvalidOperationException("Theme not found.");
        }

        await context.Presentations
            .NotDeleted()
            .Where(x => x.Id == presentationId && x.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.ThemeId, themeId)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        changeNotifier?.Notify(organizationId);
    }

    public async Task<List<OverlaySlide>> GetOverlaysAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOverlays);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.OverlaySlides
            .Where(x => x.OrganizationId == organizationId)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);
    }

    public async Task<OverlaySlide?> GetOverlayByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewOverlays);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        return await context.OverlaySlides
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);
    }

    public async Task AddOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOverlays);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(overlay.Title, AppConstraints.OverlayTitleMaxLength, "Title");
        ValidationHelper.RequireMaxLength(overlay.Content, AppConstraints.OverlayContentMaxLength, "Content");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await ValidationHelper.RequireMaxCountAsync(
            context.OverlaySlides.Where(x => x.OrganizationId == organizationId),
            AppConstraints.MaxOverlaysPerOrg, "overlays", cancellationToken);

        overlay.OrganizationId = organizationId;

        var uploadedKey = await UploadOverlayImageAsync(overlay, organizationId, cancellationToken);

        var maxSortOrder = await context.OverlaySlides
            .Where(x => x.OrganizationId == organizationId)
            .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

        overlay.SortOrder = maxSortOrder + 1;

        try
        {
            context.OverlaySlides.Add(overlay);
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception) when (uploadedKey is not null)
        {
            await storage.DeleteAsync(uploadedKey, cancellationToken);
            throw;
        }
    }

    public async Task UpdateOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOverlays);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(overlay.Title, AppConstraints.OverlayTitleMaxLength, "Title");
        ValidationHelper.RequireMaxLength(overlay.Content, AppConstraints.OverlayContentMaxLength, "Content");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var existing = await context.OverlaySlides
            .FirstOrDefaultAsync(x => x.Id == overlay.Id && x.OrganizationId == organizationId, cancellationToken);
        if (existing is null) return;

        var removingImage = existing.HasImage && !overlay.HasImage && overlay.ImageData is null;
        var uploadedKey = await UploadOverlayImageAsync(overlay, organizationId, cancellationToken);

        try
        {
            context.Entry(existing).CurrentValues.SetValues(overlay);
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception) when (uploadedKey is not null)
        {
            await storage.DeleteAsync(uploadedKey, cancellationToken);
            throw;
        }

        if (removingImage)
        {
            await storage.DeleteAsync(ImageUrlHelper.OverlayImageKey(organizationId, overlay.Id), cancellationToken);
        }
    }

    public async Task RemoveOverlayAsync(string organizationId, string overlayId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOverlays);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        // Tracked delete rather than ExecuteDelete, so the context writes the tombstone itself.
        var overlay = await context.OverlaySlides
            .FirstOrDefaultAsync(x => x.OrganizationId == organizationId && x.Id == overlayId, cancellationToken);
        if (overlay is null) return;

        context.OverlaySlides.Remove(overlay);
        await context.SaveChangesAsync(cancellationToken);

        await storage.DeleteAsync(ImageUrlHelper.OverlayImageKey(organizationId, overlayId), cancellationToken);
    }

    /// <summary>
    /// Marks the presentation as changed when something inside it changes. UpdatedAt carries the
    /// user-visible "last edited" semantics; ModifiedAt is the sync watermark and aggregate version
    /// that push conflict detection compares against.
    /// </summary>
    /// <summary>
    /// Moves the aggregate root's stamp when a child changed, and announces it. Every child
    /// mutation in this service passes through here, which is why one announcement here covers them
    /// all — and why a new child mutation that skips it is a bug in two ways at once.
    /// </summary>
    private async Task BumpPresentationAsync(PresentationContext context, string presentationId, string organizationId, CancellationToken cancellationToken)
    {
        await context.Presentations
            .NotDeleted()
            .Where(x => x.Id == presentationId && x.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow)
                .SetProperty(p => p.ModifiedAt, DateTimeOffset.UtcNow), cancellationToken);

        changeNotifier?.Notify(organizationId);
    }

    private async Task<string?> UploadOverlayImageAsync(OverlaySlide overlay, string organizationId, CancellationToken cancellationToken)
    {
        if (overlay.ImageData is null) return null;

        var key = ImageUrlHelper.OverlayImageKey(organizationId, overlay.Id);
        await storage.UploadAsync(key, overlay.ImageData, overlay.ImageContentType ?? "image/png", cancellationToken);
        overlay.HasImage = true;
        overlay.ImageData = null;
        overlay.ImageContentType = null;
        return key;
    }
}