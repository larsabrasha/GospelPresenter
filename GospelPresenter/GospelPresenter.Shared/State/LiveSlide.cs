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
    int SongFontSize = 85,
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
