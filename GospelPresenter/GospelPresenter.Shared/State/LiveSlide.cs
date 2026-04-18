namespace GospelPresenter.Shared.State;

public record LiveSlide(
    LiveSlideStatus Status,
    ProjectItemType? ItemType,
    string? ProjectItemId,
    int? ItemPartIndex,
    string? Text,
    string? Credits,
    string? ImageUrl,
    SongPart? SongPart,
    SlideTextStyle? SongStyle = null,
    SlideTextStyle? CreditsStyle = null,
    SlideTextStyle? BibleStyle = null,
    SlideTextStyle? BibleCreditsStyle = null,
    string? SongId = null,
    string? SongName = null,
    string? CcliNumber = null
);

public record ActiveOverlay(string? Text, string? ImageUrl);

public enum LiveSlideStatus
{
    ShowingPresentation,
    ShowingBlackScreen
}
