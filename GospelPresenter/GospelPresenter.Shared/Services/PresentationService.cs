using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IPresentationService
{
    Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(CancellationToken cancellationToken = default);
    Task<Presentation?> GetPresentationByIdAsync(string id, CancellationToken cancellationToken = default);
    Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CancellationToken cancellationToken = default);
    Task AddItemAsync(string presentationId, PresentationItem item, CancellationToken cancellationToken = default);
    Task RenamePresentationAsync(string id, string name, CancellationToken cancellationToken = default);
    Task ReorderItemsAsync(string presentationId, List<string> itemIds, CancellationToken cancellationToken = default);
    Task RemoveItemAsync(string presentationId, string itemId, CancellationToken cancellationToken = default);
    Task SaveAsync(Presentation presentation, CancellationToken cancellationToken = default);
}

public class PresentationService(IDbContextFactory<PresentationContext> dbContextFactory) : IPresentationService
{
    public async Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var presentations = await context.Presentations
            .OrderByDescending(x => x.UpdatedAt)
            .Take(20)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt))
            .ToListAsync(cancellationToken);

        return presentations;
    }

    public async Task<Presentation?> GetPresentationByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var presentation = await context.Presentations
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
                .ThenInclude(x => x.Parts.OrderBy(p => p.SortOrder))
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        return presentation;
    }

    public async Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CancellationToken cancellationToken = default)
    {
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

    public async Task AddItemAsync(string presentationId, PresentationItem item, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        item.PresentationId = presentationId;

        var maxSortOrder = await context.PresentationItems
            .Where(x => x.PresentationId == presentationId)
            .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

        item.SortOrder = maxSortOrder + 1;

        context.PresentationItems.Add(item);

        await context.Presentations
            .Where(x => x.Id == presentationId)
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RenamePresentationAsync(string id, string name, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.Presentations
            .Where(x => x.Id == id)
            .ExecuteUpdateAsync(x => x
                .SetProperty(p => p.Name, name)
                .SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
    }

    public async Task ReorderItemsAsync(string presentationId, List<string> itemIds, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var items = await context.PresentationItems
            .Where(x => x.PresentationId == presentationId)
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            var newIndex = itemIds.IndexOf(item.Id);
            if (newIndex >= 0)
                item.SortOrder = newIndex;
        }

        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task RemoveItemAsync(string presentationId, string itemId, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        await context.PresentationItems
            .Where(x => x.PresentationId == presentationId && x.Id == itemId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task SaveAsync(Presentation presentation, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        presentation.UpdatedAt = DateTimeOffset.UtcNow;
        context.Presentations.Update(presentation);
        await context.SaveChangesAsync(cancellationToken);
    }
}