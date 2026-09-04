using CommunityToolkit.Mvvm.ComponentModel;
using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.State;

/// <summary>
/// What the presentation editor is looking at: the presentation it loaded, the theme it resolved,
/// and the item it has expanded into slides.
///
/// This was a block of private fields on Presentation.razor, which meant every part of that page
/// had to be rendered by the page itself to see them. Passing them down as parameters instead does
/// not help: nearly all of them are records or lists, and Blazor treats a parameter it cannot prove
/// immutable as possibly changed, so a child re-renders on every render of its parent regardless.
/// Measured — see PresentationRenderTests.
///
/// Holding them here instead lets each part of the editor inject this and listen for the properties
/// it actually reads, the way Sidebar.razor already does with AppState. A slide change then repaints
/// the slide grid without rebuilding the header, the modals and the running order along with it.
///
/// Scoped, so one per circuit. [ObservableProperty] raises PropertyChanged only when the value
/// differs, which is the same discipline SharedAppState now follows.
/// </summary>
public partial class PresentationEditorState : ObservableObject
{
    /// <summary>The presentation as loaded from the database, backing every Selected* below.</summary>
    [ObservableProperty] private Presentation? loadedPresentation;

    /// <summary>
    /// The resolved theme, which is the presentation's own or the organisation's default. Fallback
    /// until the presentation has been loaded, so the first render has something to style with.
    /// </summary>
    [ObservableProperty] private SlideTheme theme = SlideTheme.Fallback;

    // Exactly one of these is set at a time: they are the selected running-order item expanded into
    // whatever it turns out to be. GetDataForSelectedItem clears them all and then fills one in.
    [ObservableProperty] private Song? selectedSong;
    [ObservableProperty] private BibleText? selectedBibleText;
    [ObservableProperty] private Image? selectedImage;
    [ObservableProperty] private Audio? selectedAudio;
    [ObservableProperty] private SlidesState? selectedSlides;

    /// <summary>The organisation's overlay library, offered in the live panel and in stage mode.</summary>
    [ObservableProperty] private List<OverlaySlide> overlaySlides = [];

    /// <summary>The organisation's saved screens, offered as outputs in the live panel.</summary>
    [ObservableProperty] private List<RemoteDisplay> savedDisplays = [];

    /// <summary>
    /// Whether the image parts are being reordered. Held here rather than in the grid because the
    /// header owns the button that turns it on and the grid owns the list that answers to it.
    /// </summary>
    [ObservableProperty] private bool isEditingImageOrder;

    /// <summary>
    /// The selected song's parts in the order the running-order item asks for, falling back to the
    /// song's first arrangement and then to the parts as stored.
    ///
    /// Here rather than on a page because two surfaces need the same answer — the slide grid and
    /// stage mode — and the inputs are all held here.
    /// </summary>
    public IList<SongPart> EffectiveSongParts(string? projectItemId)
    {
        if (SelectedSong is null) return [];

        var item = LoadedPresentation?.Items.FirstOrDefault(x => x.Id == projectItemId);
        var arrangementId = item?.ArrangementId;
        if (arrangementId is null && SelectedSong.Arrangements.Count > 0)
            arrangementId = SelectedSong.Arrangements[0].Id;

        return SelectedSong.GetArrangedParts(arrangementId);
    }
}
