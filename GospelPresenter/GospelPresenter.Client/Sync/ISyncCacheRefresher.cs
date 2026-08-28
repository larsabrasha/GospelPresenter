using GospelPresenter.Shared.Services;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Reloads the in-memory caches the shared services keep, after a pull changed their tables.
/// A seam rather than the services themselves, so the sync engine stays testable without them.
/// </summary>
public interface ISyncCacheRefresher
{
    Task RefreshSongsAsync();
    Task RefreshBiblesAsync();
}

/// <summary>The app's implementation: the same reloads the web host runs at startup.</summary>
public class SharedCacheRefresher(ISongService songService, IBibleService bibleService) : ISyncCacheRefresher
{
    public Task RefreshSongsAsync() => songService.LoadSongsAsync();
    public Task RefreshBiblesAsync() => bibleService.LoadBiblesAsync();
}
