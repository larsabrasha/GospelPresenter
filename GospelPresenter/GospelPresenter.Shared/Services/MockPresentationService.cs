using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.Services;

public class MockPresentationService : IPresentationService
{
    private readonly List<Presentation> presentations = [];

    public MockPresentationService()
    {
        var now = DateTimeOffset.UtcNow;
        presentations.Add(new Presentation
        {
            Id = Guid.NewGuid().ToString(),
            Name = "Söndagsgudstjänst",
            OrganizationId = "org1",
            CreatedAt = now,
            CreatedBy = "user1",
            UpdatedAt = now,
            UpdatedBy = "user1",
            Items = []
        });
    }

    public Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var summaries = presentations
            .Where(x => x.OrganizationId == organizationId)
            .OrderByDescending(x => x.UpdatedAt)
            .Take(20)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt))
            .ToList();

        return Task.FromResult<IList<PresentationSummary>>(summaries);
    }

    public Task<Presentation?> GetPresentationByIdAsync(string id, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var presentation = presentations.FirstOrDefault(x => x.Id == id && x.OrganizationId == organizationId);
        return Task.FromResult(presentation);
    }

    public Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var now = DateTimeOffset.UtcNow;
        var presentation = new Presentation
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            OrganizationId = organizationId,
            CreatedAt = now,
            CreatedBy = userId,
            UpdatedAt = now,
            UpdatedBy = userId,
            Items = []
        };

        presentations.Add(presentation);
        return Task.FromResult(presentation);
    }

    public Task AddItemAsync(string organizationId, string presentationId, PresentationItem item, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var presentation = presentations.FirstOrDefault(x => x.Id == presentationId && x.OrganizationId == organizationId);
        if (presentation is null) return Task.CompletedTask;

        item.PresentationId = presentationId;
        item.SortOrder = presentation.Items.Count > 0
            ? presentation.Items.Max(x => x.SortOrder) + 1
            : 0;

        if (!presentation.Items.Any(x => x.Id == item.Id))
            presentation.Items.Add(item);
        presentation.UpdatedAt = DateTimeOffset.UtcNow;

        return Task.CompletedTask;
    }

    public Task RenamePresentationAsync(string organizationId, string id, string name, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var presentation = presentations.FirstOrDefault(x => x.Id == id && x.OrganizationId == organizationId);
        if (presentation is not null)
        {
            presentation.Name = name;
            presentation.UpdatedAt = DateTimeOffset.UtcNow;
        }

        return Task.CompletedTask;
    }

    public Task ReorderItemsAsync(string organizationId, string presentationId, List<string> itemIds, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var presentation = presentations.FirstOrDefault(x => x.Id == presentationId && x.OrganizationId == organizationId);
        if (presentation is null) return Task.CompletedTask;

        foreach (var item in presentation.Items)
        {
            var newIndex = itemIds.IndexOf(item.Id);
            if (newIndex >= 0)
                item.SortOrder = newIndex;
        }

        presentation.Items = presentation.Items.OrderBy(x => x.SortOrder).ToList();

        return Task.CompletedTask;
    }

    public Task RemoveItemAsync(string organizationId, string presentationId, string itemId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var presentation = presentations.FirstOrDefault(x => x.Id == presentationId && x.OrganizationId == organizationId);
        presentation?.Items.RemoveAll(x => x.Id == itemId);

        return Task.CompletedTask;
    }

    public Task DeletePresentationAsync(string organizationId, string id, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        presentations.RemoveAll(x => x.Id == id && x.OrganizationId == organizationId);
        return Task.CompletedTask;
    }

    public Task SaveAsync(string organizationId, Presentation presentation, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var existing = presentations.FirstOrDefault(x => x.Id == presentation.Id && x.OrganizationId == organizationId);
        if (existing is not null)
        {
            presentations.Remove(existing);
        }

        presentation.UpdatedAt = DateTimeOffset.UtcNow;
        presentations.Add(presentation);

        return Task.CompletedTask;
    }

    private readonly List<OverlaySlide> overlays = [];

    public Task<List<OverlaySlide>> GetOverlaysAsync(string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var result = overlays.Where(x => x.OrganizationId == organizationId).OrderBy(x => x.SortOrder).ToList();
        return Task.FromResult(result);
    }

    public Task AddOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        overlay.OrganizationId = organizationId;
        overlay.SortOrder = overlays.Count(x => x.OrganizationId == organizationId);
        overlays.Add(overlay);
        return Task.CompletedTask;
    }

    public Task UpdateOverlayAsync(string organizationId, OverlaySlide overlay, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        var index = overlays.FindIndex(x => x.Id == overlay.Id && x.OrganizationId == organizationId);
        if (index >= 0) overlays[index] = overlay;
        return Task.CompletedTask;
    }

    public Task RemoveOverlayAsync(string organizationId, string overlayId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequireOrganizationAccess(organizationId);
        overlays.RemoveAll(x => x.OrganizationId == organizationId && x.Id == overlayId);
        return Task.CompletedTask;
    }
}
