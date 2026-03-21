using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IPresentationService
{
    Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation?> GetPresentationByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CallerContext caller, CancellationToken cancellationToken = default);
    Task AddItemAsync(string organizationId, string presentationId, PresentationItem item, CallerContext caller, CancellationToken cancellationToken = default);
    Task RenamePresentationAsync(string organizationId, string id, string name, CallerContext caller, CancellationToken cancellationToken = default);
    Task ReorderItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default);
    Task RenameItemAsync(string organizationId, string presentationId, string itemId, string title, CallerContext caller, CancellationToken cancellationToken = default);
    Task AddItemPartsAsync(string organizationId, string presentationId, string itemId, List<PresentationItemPart> parts, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveItemPartAsync(string organizationId, string presentationId, string itemId, string partId, CallerContext caller, CancellationToken cancellationToken = default);
    Task ReorderItemPartsAsync(string organizationId, string presentationId, string itemId, List<string> partIds, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveItemAsync(string organizationId, string presentationId, string itemId, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default);
    Task SaveAsync(string organizationId, Presentation presentation, CallerContext caller, CancellationToken cancellationToken = default);
    Task DeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default);
    Task<List<OverlaySlide>> GetOverlaysAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<OverlaySlide?> GetOverlayByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task AddOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default);
    Task UpdateOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default);
    Task RemoveOverlayAsync(string organizationId, string overlayId, CallerContext caller, CancellationToken cancellationToken = default);
}

public class PresentationService(IDbContextFactory<PresentationContext> dbContextFactory) : IPresentationService
{
    public async Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var presentations = await context.Presentations
            .Where(x => x.OrganizationId == organizationId)
            .OrderByDescending(x => x.UpdatedAt)
            .Take(20)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt))
            .ToListAsync(cancellationToken);

        return presentations;
    }

    public async Task<Presentation?> GetPresentationByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var presentation = await context.Presentations
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
                .ThenInclude(x => x.Parts.OrderBy(p => p.SortOrder))
            .FirstOrDefaultAsync(x => x.Id == id && x.OrganizationId == organizationId, cancellationToken);

        return presentation;
    }

    public async Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

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
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

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
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.Id == itemId && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.Title, title), cancellationToken);
    }

    public async Task AddItemPartsAsync(string organizationId, string presentationId, string itemId, List<PresentationItemPart> parts, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

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

        await context.PresentationItems
            .Where(x => x.PresentationId == presentationId && x.Id == itemId && x.Presentation.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task RemoveItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(p => itemIds.Contains(p.PresentationItemId) && p.PresentationItem.PresentationId == presentationId && p.PresentationItem.Presentation.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => itemIds.Contains(x.Id) && x.PresentationId == presentationId && x.Presentation.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task SaveAsync(string organizationId, Presentation presentation, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
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
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        await context.PresentationItemParts
            .Where(p => p.PresentationItem.PresentationId == id)
            .ExecuteDeleteAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.PresentationId == id)
            .ExecuteDeleteAsync(cancellationToken);

        await context.Presentations
            .Where(x => x.Id == id && x.OrganizationId == organizationId)
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
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
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        overlay.OrganizationId = organizationId;

        var maxSortOrder = await context.OverlaySlides
            .Where(x => x.OrganizationId == organizationId)
            .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

        overlay.SortOrder = maxSortOrder + 1;

        context.OverlaySlides.Add(overlay);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task UpdateOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOverlays);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var existing = await context.OverlaySlides
            .FirstOrDefaultAsync(x => x.Id == overlay.Id && x.OrganizationId == organizationId, cancellationToken);
        if (existing is null) return;

        context.Entry(existing).CurrentValues.SetValues(overlay);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RemoveOverlayAsync(string organizationId, string overlayId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManageOverlays);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.OverlaySlides
            .Where(x => x.OrganizationId == organizationId && x.Id == overlayId)
            .ExecuteDeleteAsync(cancellationToken);
    }
}