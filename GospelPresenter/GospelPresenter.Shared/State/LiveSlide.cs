namespace GospelPresenter.Shared.State;

public record LiveSlide(
    LiveSlideStatus Status,
    string? ProjectItemId,
    int? ItemPartIndex,
    string? Text,
    string? Credits,
    string? ImageUrl
);

public enum LiveSlideStatus
{
    ShowingPresentation,
    ShowingBlackScreen
}
