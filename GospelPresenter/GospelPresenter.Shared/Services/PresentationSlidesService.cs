using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IPresentationSlidesService
{
    Task<PresentationSlides> GetByIdAsync(string slidesId, string organizationId, CallerContext caller, CancellationToken cancellationToken = default);
    Task<(PresentationSlides Slides, PresentationItem Item)> AddSlidesAsync(
        string organizationId, string presentationId, string fileName,
        IReadOnlyList<RenderedPage> pages, CallerContext caller,
        CancellationToken cancellationToken = default);
}

public class PresentationSlidesService(
    IDbContextFactory<PresentationContext> dbContextFactory,
    IObjectStorageService storage) : IPresentationSlidesService
{
    public async Task<PresentationSlides> GetByIdAsync(string slidesId, string organizationId, CallerContext caller, CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);
        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var slides = await context.PresentationSlides
            .AsNoTracking()
            .Include(s => s.Presentation)
            .FirstOrDefaultAsync(s => s.Id == slidesId && s.Presentation.OrganizationId == organizationId, cancellationToken);

        return slides ?? throw new InvalidOperationException("Slides not found.");
    }

    public async Task<(PresentationSlides Slides, PresentationItem Item)> AddSlidesAsync(
        string organizationId, string presentationId, string fileName,
        IReadOnlyList<RenderedPage> pages, CallerContext caller,
        CancellationToken cancellationToken = default)
    {
        caller.RequirePermission(Permission.ManagePresentations);
        caller.RequireOrganizationAccess(organizationId);
        ValidationHelper.RequireMaxLength(fileName, AppConstraints.FileNameMaxLength, "FileName");

        await using (var verifyContext = await dbContextFactory.CreateDbContextAsync(cancellationToken))
        {
            var exists = await verifyContext.Presentations
                .AnyAsync(p => p.Id == presentationId && p.OrganizationId == organizationId, cancellationToken);
            if (!exists) throw new InvalidOperationException("Presentation not found.");
        }

        var slides = new PresentationSlides
        {
            FileName = fileName,
            PageCount = pages.Count,
            PresentationId = presentationId
        };

        try
        {
            foreach (var page in pages)
            {
                await storage.UploadAsync(ImageUrlHelper.SlidesPageKey(organizationId, slides.Id, page.Index), page.Bytes, "image/webp", cancellationToken);
            }
        }
        catch
        {
            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, slides.Id), cancellationToken);
            throw;
        }

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            context.PresentationSlides.Add(slides);

            var maxSortOrder = await context.PresentationItems
                .Where(x => x.PresentationId == presentationId)
                .MaxAsync(x => (int?)x.SortOrder, cancellationToken) ?? -1;

            var itemId = Guid.NewGuid().ToString();
            var item = new PresentationItem
            {
                Id = itemId,
                SourceId = slides.Id,
                Type = PresentationItemType.Slides,
                Title = fileName,
                SortOrder = maxSortOrder + 1,
                PresentationId = presentationId,
                Parts = pages.Select(p => new PresentationItemPart
                {
                    Id = Guid.NewGuid().ToString(),
                    Content = p.Index.ToString(),
                    SortOrder = p.Index,
                    PresentationItemId = itemId
                }).ToList()
            };

            context.PresentationItems.Add(item);

            await context.Presentations
                .Where(x => x.Id == presentationId)
                .ExecuteUpdateAsync(x => x.SetProperty(p => p.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return (slides, item);
        }
        catch
        {
            await storage.DeleteByPrefixAsync(ImageUrlHelper.SlidesPrefix(organizationId, slides.Id), cancellationToken);
            throw;
        }
    }
}
