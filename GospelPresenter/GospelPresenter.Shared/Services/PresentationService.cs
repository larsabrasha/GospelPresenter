using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public record DashboardPresentations(
    IList<PresentationSummary> Today,
    IList<PresentationSummary> Upcoming,
    IList<PresentationSummary> Previous);

public record PresentationSummaryPage(
    IReadOnlyList<PresentationSummary> Items,
    int TotalCount);

public enum PresentationSortOrder
{
    UpdatedDesc,
    NameAsc,
    EventDateDesc,
    EventDateAsc
}

public interface IPresentationService
{
    Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<DashboardPresentations> GetDashboardPresentationsAsync(string organizationId, DateOnly today, CallerContext caller, CancellationToken cancellationToken = default);
    Task<PresentationSummaryPage> GetPresentationSummariesPageAsync(string organizationId, int skip, int take, PresentationSortOrder sort, CallerContext caller, CancellationToken cancellationToken = default);
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
    Task DeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task<IList<PresentationSummary>> GetRecentTemplateSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<IList<PresentationSummary>> GetAllTemplateSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation> SaveAsTemplateAsync(string presentationId, string name, string organizationId, string userId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation> CreatePresentationFromTemplateAsync(string templateId, string name, string organizationId, string userId, CallerContext caller, DateOnly? eventDate = null, TimeOnly? eventTime = null, string? eventLocation = null, string? description = null, CancellationToken cancellationToken = default);
    Task<Presentation> CreateTemplateAsync(string name, string organizationId, string userId, CallerContext caller, int? scheduledDayOfWeek = null, TimeOnly? scheduledTime = null, string? location = null, CancellationToken cancellationToken = default);
    Task UpdateTemplateScheduleAsync(string organizationId, string templateId, int? dayOfWeek, TimeOnly? time, string? location, CallerContext caller, CancellationToken cancellationToken = default);
    Task UpdatePresentationEventAsync(string organizationId, string presentationId, DateOnly? date, TimeOnly? time, string? location, string? description, CallerContext caller, CancellationToken cancellationToken = default);
    Task DeleteTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task<List<OverlaySlide>> GetOverlaysAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OverlaySlide?> GetOverlayByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task AddOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default);
    Task UpdateOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveOverlayAsync(string organizationId, string overlayId, CallerContext caller, CancellationToken cancellationToken = default);
}

public class PresentationService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    IObjectStorageService storage) : IPresentationService
{
    public async Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var presentations = await context.Presentations
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
            .Where(x => x.OrganizationId == organizationId && !x.IsTemplate);

        var todayList = await orgPresentations
            .Where(x => x.EventDate == today)
            .OrderBy(x => x.EventTime ?? TimeOnly.MaxValue)
            .ThenByDescending(x => x.UpdatedAt)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt) { Location = x.EventLocation, EventDate = x.EventDate, EventTime = x.EventTime })
            .ToListAsync(cancellationToken);

        var upcomingList = await orgPresentations
            .Where(x => x.EventDate > today)
            .OrderBy(x => x.EventDate)
            .ThenBy(x => x.EventTime ?? TimeOnly.MaxValue)
            .Take(5)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt) { Location = x.EventLocation, EventDate = x.EventDate, EventTime = x.EventTime })
            .ToListAsync(cancellationToken);

        var previousList = await orgPresentations
            .Where(x => x.EventDate == null || x.EventDate < today)
            .OrderByDescending(x => x.EventDate.HasValue)
            .ThenByDescending(x => x.EventDate)
            .ThenByDescending(x => x.EventTime ?? TimeOnly.MinValue)
            .ThenByDescending(x => x.UpdatedAt)
            .Take(5)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt) { Location = x.EventLocation, EventDate = x.EventDate, EventTime = x.EventTime })
            .ToListAsync(cancellationToken);

        return new DashboardPresentations(todayList, upcomingList, previousList);
    }

    public async Task<PresentationSummaryPage> GetPresentationSummariesPageAsync(string organizationId, int skip, int take, PresentationSortOrder sort, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);

        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 1, 200);

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var query = context.Presentations
            .Where(x => x.OrganizationId == organizationId && !x.IsTemplate);

        var total = await query.CountAsync(cancellationToken);

        var ordered = sort switch
        {
            PresentationSortOrder.NameAsc => query
                .OrderBy(x => x.Name)
                .ThenByDescending(x => x.UpdatedAt),
            PresentationSortOrder.EventDateDesc => query
                .OrderByDescending(x => x.EventDate.HasValue)
                .ThenByDescending(x => x.EventDate)
                .ThenByDescending(x => x.EventTime ?? TimeOnly.MinValue)
                .ThenByDescending(x => x.UpdatedAt),
            PresentationSortOrder.EventDateAsc => query
                .OrderByDescending(x => x.EventDate.HasValue)
                .ThenBy(x => x.EventDate)
                .ThenBy(x => x.EventTime ?? TimeOnly.MaxValue)
                .ThenByDescending(x => x.UpdatedAt),
            _ => query.OrderByDescending(x => x.UpdatedAt)
        };

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
        await ValidationHelper.RequireMaxCountAsync(
            context.Presentations.Where(x => x.OrganizationId == organizationId && !x.IsTemplate),
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
        await ValidationHelper.RequireMaxCountAsync(
            context.PresentationItems.Where(x => x.PresentationId == presentationId),
            AppConstraints.MaxItemsPerPresentation, "items", cancellationToken);

        item.PresentationId = presentationId;

        var maxSortOrder = await context.PresentationItems
            .Where(x => x.PresentationId == presentationId)
            .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

        item.SortOrder = maxSortOrder + 1;

        context.PresentationItems.Add(item);

        await context.Presentations
            .Where(x => x.Id == presentationId && x.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RenamePresentationAsync(string organizationId, string id, string name, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(name, AppConstraints.NameMaxLength, "Name");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.Presentations
            .Where(x => x.Id == id && x.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.Name, name)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
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
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.Title, title), cancellationToken);
    }

    public async Task UpdateItemArrangementAsync(string organizationId, string presentationId, string itemId, string? arrangementId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.Id == itemId && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.ArrangementId, arrangementId), cancellationToken);
    }

    public async Task AddItemPartsAsync(string organizationId, string presentationId, string itemId, List<PresentationItemPart> parts, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        foreach (var part in parts)
            ValidationHelper.RequireMaxLength(part.Content, AppConstraints.PresentationItemPartContentMaxLength, "Content");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
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
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RemoveItemPartAsync(string organizationId, string presentationId, string itemId, string partId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(x => x.Id == partId && x.PresentationItemId == itemId && x.PresentationItem.PresentationId == presentationId && x.PresentationItem.Presentation.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);
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

            await transaction.CommitAsync(cancellationToken);

            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, item.SourceId!), cancellationToken);
        }
        else
        {
            await context.PresentationItems
                .Where(x => x.Id == itemId)
                .ExecuteDeleteAsync(cancellationToken);
        }
    }

    public async Task RemoveItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

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
            .FirstOrDefaultAsync(x => x.Id == presentation.Id && x.OrganizationId == organizationId, cancellationToken);
        if (existing is null) return;

        existing.Name = presentation.Name;
        existing.UpdatedAt = DateTimeOffset.UtcNow;
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var slidesIds = await context.PresentationItems
            .Where(x => x.PresentationId == id && x.Presentation.OrganizationId == organizationId
                && x.Type == PresentationItemType.Slides && x.SourceId != null)
            .Select(x => x.SourceId!)
            .ToListAsync(cancellationToken);

        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(p => p.PresentationItem.PresentationId == id)
            .ExecuteDeleteAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.PresentationId == id)
            .ExecuteDeleteAsync(cancellationToken);

        if (slidesIds.Count > 0)
        {
            await context.PresentationSlides
                .Where(s => slidesIds.Contains(s.Id))
                .ExecuteDeleteAsync(cancellationToken);
        }

        await context.Presentations
            .Where(x => x.Id == id && x.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

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
            context.Presentations.Where(x => x.OrganizationId == organizationId && x.IsTemplate),
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
            context.Presentations.Where(x => x.OrganizationId == organizationId && x.IsTemplate),
            AppConstraints.MaxTemplatesPerOrg, "templates", cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var source = await context.Presentations
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
            context.Presentations.Where(x => x.OrganizationId == organizationId && !x.IsTemplate),
            AppConstraints.MaxPresentationsPerOrg, "presentations", cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        var template = await context.Presentations
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
            .Where(x => x.Id == templateId && x.OrganizationId == organizationId && x.IsTemplate)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.ScheduledDayOfWeek, dayOfWeek)
                .SetProperty(p => p.ScheduledTime, time)
                .SetProperty(p => p.EventLocation, location)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
    }

    public async Task UpdatePresentationEventAsync(string organizationId, string presentationId, DateOnly? date, TimeOnly? time, string? location, string? description, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(location, AppConstraints.LocationMaxLength, "Location");
        ValidationHelper.RequireMaxLength(description, AppConstraints.DescriptionMaxLength, "Description");
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.Presentations
            .Where(x => x.Id == presentationId && x.OrganizationId == organizationId && !x.IsTemplate)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.EventDate, date)
                .SetProperty(p => p.EventTime, time)
                .SetProperty(p => p.EventLocation, location)
                .SetProperty(p => p.Description, description)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
    }

    public async Task DeleteTemplateAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageTemplates);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var slidesIds = await context.PresentationItems
            .Where(x => x.PresentationId == id && x.Presentation.OrganizationId == organizationId
                && x.Type == PresentationItemType.Slides && x.SourceId != null)
            .Select(x => x.SourceId!)
            .ToListAsync(cancellationToken);

        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(p => p.PresentationItem.PresentationId == id)
            .ExecuteDeleteAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.PresentationId == id)
            .ExecuteDeleteAsync(cancellationToken);

        if (slidesIds.Count > 0)
        {
            await context.PresentationSlides
                .Where(s => slidesIds.Contains(s.Id))
                .ExecuteDeleteAsync(cancellationToken);
        }

        await context.Presentations
            .Where(x => x.Id == id && x.OrganizationId == organizationId && x.IsTemplate)
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        foreach (var slidesId in slidesIds)
            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, slidesId), cancellationToken);
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

        await context.OverlaySlides
            .Where(x => x.OrganizationId == organizationId && x.Id == overlayId)
            .ExecuteDeleteAsync(cancellationToken);

        await storage.DeleteAsync(ImageUrlHelper.OverlayImageKey(organizationId, overlayId), cancellationToken);
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