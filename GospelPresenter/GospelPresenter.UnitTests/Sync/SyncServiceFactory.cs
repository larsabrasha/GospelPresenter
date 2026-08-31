using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.Sync;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// Builds a SyncService with real domain services over the given context factory, and test
/// doubles for the seams that would otherwise need infrastructure: object storage is a no-op and
/// the localizer answers with a fixed suffix.
/// </summary>
internal static class SyncServiceFactory
{
    public const string OfflineSuffix = "(offline-ändringar)";

    public static SyncService Create(IDbContextFactory<PresentationContext> factory)
    {
        var storage = new NoOpObjectStorageService();
        return new SyncService(
            factory,
            storage,
            new FakeLocalizer(),
            new PresentationService(factory, storage),
            new SongService(factory),
            new SongPartLabelService(factory),
            new OrganizationImageService(factory, storage),
            new OrganizationAudioService(factory, storage));
    }

    private class FakeLocalizer : IStringLocalizer<SharedResource>
    {
        public LocalizedString this[string name] =>
            new(name, name == "Sync.OfflineChangesSuffix" ? OfflineSuffix : name);

        public LocalizedString this[string name, params object[] arguments] => this[name];

        public IEnumerable<LocalizedString> GetAllStrings(bool includeParentCultures) => [];
    }

    private class NoOpObjectStorageService : IObjectStorageService
    {
        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult<(Stream, string)?>(null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
