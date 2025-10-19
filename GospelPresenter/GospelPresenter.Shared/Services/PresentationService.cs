using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IPresentationService
{
    Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(CancellationToken cancellationToken = default);
    Task<Presentation?> GetPresentationByIdAsync(string id, CancellationToken cancellationToken = default);
}

public class PresentationService(IDbContextFactory<PresentationContext> dbContextFactory) : IPresentationService
{
    public Task<IList<PresentationSummary>> GetRecentPresentationSummariesAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult<IList<PresentationSummary>>([]);
    }

    public async Task<Presentation?> GetPresentationByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        
        var presentation = await context.Presentations.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        
        return presentation;
    }
}
