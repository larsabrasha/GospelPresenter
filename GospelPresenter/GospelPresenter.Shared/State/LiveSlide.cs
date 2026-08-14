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
    // The resolved theme travels with the slide rather than being looked up per surface: the public
    // output renders one server-side fragment shared by every viewer, so it needs the definition in
    // hand. Built-in definitions are immutable per deployment, so this is a shared reference.
    SlideTheme? Theme = null,
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
