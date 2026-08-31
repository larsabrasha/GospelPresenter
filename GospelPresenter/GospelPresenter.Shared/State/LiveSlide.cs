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

/// <summary>
/// The overlay currently over the slide. <paramref name="Id"/> is what it was chosen by, kept
/// alongside the rendered text and image so a session can say which overlay is up without the
/// listener having to recognise it from a URL — a text-only overlay has no URL to recognise.
/// </summary>
public record ActiveOverlay(string? Text, string? ImageUrl, string? Id = null);

public enum LiveSlideStatus
{
    ShowingPresentation,
    ShowingBlackScreen
}
