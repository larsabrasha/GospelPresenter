namespace GospelPresenter.Shared.State;

public record LiveSlide(
    LiveSlideStatus Status,
    string? ProjectItemId,
    int? ItemPartIndex,
    string? Text
);

public enum LiveSlideStatus
{
    ShowingPresentation,
    ShowingBlackScreen
}
