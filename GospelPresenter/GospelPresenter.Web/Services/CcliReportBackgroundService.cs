using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;

namespace GospelPresenter.Web.Services;

public class CcliReportBackgroundService(
    SharedAppState sharedAppState,
    ICcliReportService ccliReportService,
    ILogger<CcliReportBackgroundService> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        sharedAppState.CcliSongDisplayed += OnSongDisplayed;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        sharedAppState.CcliSongDisplayed -= OnSongDisplayed;
        return Task.CompletedTask;
    }

    private async void OnSongDisplayed(CcliSongDisplayedEvent evt)
    {
        try
        {
            await ccliReportService.RecordSongDisplayAsync(
                evt.OrganizationId, evt.SongId, evt.SongName, evt.CcliNumber,
                evt.PresentationId, evt.PresentationName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to record CCLI display for song {SongId} in org {OrgId}", evt.SongId, evt.OrganizationId);
        }
    }
}
