using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client;

/// <summary>
/// The device's CCLI compliance recorder: what CcliReportBackgroundService does on the web, as a
/// plain singleton because MAUI runs no hosted services. Each displayed song becomes a local
/// CcliReportEntry row (gated on the synced organisation setting), which the journal trigger
/// queues and the sync engine pushes to the idempotent report endpoint — so displays during an
/// offline service are reported when the device gets back online.
/// </summary>
public class CcliReportListener(
    SharedAppState sharedAppState,
    ICcliReportService ccliReportService,
    ILogger<CcliReportListener> logger) : IDisposable
{
    public void Start() => sharedAppState.CcliSongDisplayed += OnSongDisplayed;

    private async void OnSongDisplayed(CcliSongDisplayedEvent evt)
    {
        try
        {
            await RecordAsync(evt);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to record the CCLI display for song {SongId}", evt.SongId);
        }
    }

    public Task RecordAsync(CcliSongDisplayedEvent evt) =>
        ccliReportService.RecordSongDisplayAsync(
            evt.OrganizationId, evt.SongId, evt.SongName, evt.CcliNumber,
            evt.PresentationId, evt.PresentationName);

    public void Dispose() => sharedAppState.CcliSongDisplayed -= OnSongDisplayed;
}
