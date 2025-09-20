using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services.InitialData;

public class InitialDataService(
    AppState appState
) : IInitialDataService
{
    public Task DownloadInitialDataAsync()
    {
        appState.InitialDataProgress = ProgressEnum.Success;

        return Task.CompletedTask;
    }
}
