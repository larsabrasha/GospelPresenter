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

    public Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(CancellationToken cancellationToken = default)
    {
        var summaries = presentations
            .OrderByDescending(x => x.UpdatedAt)
            .Take(20)
            .Select(x => new PresentationSummary(x.Id, x.Name, x.UpdatedAt))
            .ToList();

        return Task.FromResult<IList<PresentationSummary>>(summaries);
    }

    public Task<Presentation?> GetPresentationByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var presentation = presentations.FirstOrDefault(x => x.Id == id);
        return Task.FromResult(presentation);
    }

    public Task<Presentation> CreatePresentationAsync(string name, string organizationId, string userId, CancellationToken cancellationToken = default)
    {
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

    public Task AddItemAsync(string presentationId, PresentationItem item, CancellationToken cancellationToken = default)
    {
        var presentation = presentations.FirstOrDefault(x => x.Id == presentationId);
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

    public Task RenamePresentationAsync(string id, string name, CancellationToken cancellationToken = default)
    {
        var presentation = presentations.FirstOrDefault(x => x.Id == id);
        if (presentation is not null)
        {
            presentation.Name = name;
            presentation.UpdatedAt = DateTimeOffset.UtcNow;
        }

        return Task.CompletedTask;
    }

    public Task ReorderItemsAsync(string presentationId, List<string> itemIds, CancellationToken cancellationToken = default)
    {
        var presentation = presentations.FirstOrDefault(x => x.Id == presentationId);
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

    public Task RemoveItemAsync(string presentationId, string itemId, CancellationToken cancellationToken = default)
    {
        var presentation = presentations.FirstOrDefault(x => x.Id == presentationId);
        presentation?.Items.RemoveAll(x => x.Id == itemId);

        return Task.CompletedTask;
    }

    public Task DeletePresentationAsync(string id, CancellationToken cancellationToken = default)
    {
        presentations.RemoveAll(x => x.Id == id);
        return Task.CompletedTask;
    }

    public Task SaveAsync(Presentation presentation, CancellationToken cancellationToken = default)
    {
        var existing = presentations.FirstOrDefault(x => x.Id == presentation.Id);
        if (existing is not null)
        {
            presentations.Remove(existing);
        }

        presentation.UpdatedAt = DateTimeOffset.UtcNow;
        presentations.Add(presentation);

        return Task.CompletedTask;
    }

    private readonly List<OverlaySlide> overlays = [];

    public Task<List<OverlaySlide>> GetOverlaysAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        var result = overlays.Where(x => x.OrganizationId == organizationId).OrderBy(x => x.SortOrder).ToList();
        return Task.FromResult(result);
    }

    public Task AddOverlayAsync(string organizationId, OverlaySlide overlay, CancellationToken cancellationToken = default)
    {
        overlay.OrganizationId = organizationId;
        overlay.SortOrder = overlays.Count(x => x.OrganizationId == organizationId);
        overlays.Add(overlay);
        return Task.CompletedTask;
    }

    public Task UpdateOverlayAsync(OverlaySlide overlay, CancellationToken cancellationToken = default)
    {
        var index = overlays.FindIndex(x => x.Id == overlay.Id);
        if (index >= 0) overlays[index] = overlay;
        return Task.CompletedTask;
    }

    public Task RemoveOverlayAsync(string organizationId, string overlayId, CancellationToken cancellationToken = default)
    {
        overlays.RemoveAll(x => x.OrganizationId == organizationId && x.Id == overlayId);
        return Task.CompletedTask;
    }
}
