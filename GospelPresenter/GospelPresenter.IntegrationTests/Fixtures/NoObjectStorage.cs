using GospelPresenter.Shared.Services;

namespace GospelPresenter.IntegrationTests.Fixtures;

/// <summary>
/// Blob storage that accepts everything and holds nothing.
///
/// The application registers <c>NullObjectStorageService</c> when no S3 settings are configured, and
/// that one throws — which is right for a deployment that has forgotten to configure storage, and
/// wrong for a test server, where there is nothing to configure. Without this, deleting a
/// presentation that owns slides fails after its rows are already gone.
/// </summary>
public sealed class NoObjectStorage : IObjectStorageService
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
