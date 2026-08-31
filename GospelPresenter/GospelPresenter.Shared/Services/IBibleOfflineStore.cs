namespace GospelPresenter.Shared.Services;

public enum BibleOfflineState
{
    /// <summary>Metadata only: the verses live on the server.</summary>
    NotAvailable,

    /// <summary>Downloaded on the user's request; kept fresh and removable.</summary>
    Downloaded,

    /// <summary>Imported on this device — the verses exist here whether or not the server has them.</summary>
    ImportedLocally,
}

/// <summary>
/// Offline Bible translations. Only the MAUI host registers an implementation — the web always
/// reads verses from its own database — so the Bibles page resolves this optionally and shows the
/// download controls only when it exists. Keyed by abbreviation, which is what the UI's cached
/// Bible records carry.
/// </summary>
public interface IBibleOfflineStore
{
    Task<IReadOnlyDictionary<string, BibleOfflineState>> GetStatesAsync(string organizationId, CancellationToken cancellationToken = default);

    /// <summary>Downloads the translation's verses; false when the server could not provide them.</summary>
    Task<bool> DownloadAsync(string organizationId, string abbreviation, CancellationToken cancellationToken = default);

    /// <summary>Frees the local copy (metadata stays; the server still has the verses).</summary>
    Task RemoveAsync(string organizationId, string abbreviation, CancellationToken cancellationToken = default);
}
