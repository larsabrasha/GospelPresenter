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
    string? VideoId = null
);

public record ActiveOverlay(string? Text, string? ImageUrl);

public enum LiveSlideStatus
{
    ShowingPresentation,
    ShowingBlackScreen
}
