using CommunityToolkit.Mvvm.ComponentModel;

namespace GospelPresenter.Shared.State;

public partial class SharedAppState : ObservableObject
{
    [ObservableProperty] private LiveSlide liveSlide = new(
        LiveSlideStatus.ShowingPresentation,
        null,
        null,
        null,
        null,
        null
    );

    public void SelectBlackScreen()
    {
        LiveSlide = LiveSlide with
        {
            Status = LiveSlideStatus.ShowingBlackScreen
        };
    }
}
