using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// The selection an operator has made: one item of a presentation, and one part within it. This is
/// the whole of what a controlling surface decides — everything else on the slide is derived.
/// </summary>
/// <param name="SessionId">
/// Whose live view the slide is for. It goes into the image URLs, which are served only while that
/// session is presenting, so it must be the session the slide will actually be shown under.
/// </param>
/// <param name="Presentation">
/// The loaded presentation, for the parts that live on the item rather than in the song library.
/// Nullable because the callers reach for it defensively — a song still resolves from the library
/// without it.
/// </param>
public sealed record LiveSlideRequest(
    string SessionId,
    string OrganizationId,
    string ItemId,
    ProjectItemType ItemType,
    string? SourceId,
    int PartIndex,
    Presentation? Presentation,
    SlideTheme? Theme,
    CallerContext Caller)
{
    /// <summary>
    /// Builds a request from the presentation alone, for callers that have no separate project
    /// model to read the item's type and source from — the server rebuilding a slide from an
    /// echoed selection. Returns null when the presentation has no such item.
    /// </summary>
    public static LiveSlideRequest? ForItem(
        string sessionId,
        string organizationId,
        Presentation presentation,
        string itemId,
        int partIndex,
        SlideTheme? theme,
        CallerContext caller)
    {
        var item = presentation.Items.FirstOrDefault(x => x.Id == itemId);
        if (item is null) return null;

        return new LiveSlideRequest(
            sessionId,
            organizationId,
            itemId,
            item.Type.ToProjectItemType(),
            item.SourceId,
            partIndex,
            presentation,
            theme,
            caller);
    }
}

/// <summary>
/// Turns a selection into the slide that surfaces render.
///
/// Extracted from the presentation page so the same slide can be built without a Blazor circuit:
/// a desktop client echoes only its selection to the server, and the server has to arrive at
/// exactly what the operator's own machine is showing — including the image URLs, which differ
/// between the two hosts and therefore cannot be echoed.
/// </summary>
public interface ILiveSlideBuilder
{
    /// <summary>
    /// The slide for a selection, or null when the selection has no slide of its own. Audio items
    /// are the case that matters: they play without changing what is on the screen.
    /// </summary>
    /// <param name="current">
    /// The slide being replaced. Fields the selection does not determine are carried over from it.
    /// </param>
    LiveSlide? Build(LiveSlide current, LiveSlideRequest request);
}

public class LiveSlideBuilder(ISongService songService) : ILiveSlideBuilder
{
    public LiveSlide? Build(LiveSlide current, LiveSlideRequest request)
    {
        string? text = null;
        string? credits = null;
        string? imageUrl = null;
        SongPart? songPart = null;
        string? songId = null;
        string? songName = null;
        string? ccliNumber = null;

        var item = request.Presentation?.Items.FirstOrDefault(x => x.Id == request.ItemId);

        switch (request.ItemType)
        {
            case ProjectItemType.Song:
            {
                var song = ResolveSong(request, item);
                var arrangementId = item?.ArrangementId ?? song?.Arrangements.FirstOrDefault()?.Id;
                var parts = song is not null ? song.GetArrangedParts(arrangementId) : [];
                if (song is not null && request.PartIndex < parts.Count)
                {
                    songPart = parts[request.PartIndex];
                    // Plain text, not HTML: LiveSlide.Text is rendered as markup for Bible
                    // slides, so song content must never be turned into markup here.
                    text = songPart.Content;
                    credits = FormatSongCredits(song);
                    songId = song.Id;
                    songName = song.Name;
                    ccliNumber = song.Ccli;
                }

                break;
            }
            case ProjectItemType.Image:
            {
                var parts = item?.Parts.OrderBy(p => p.SortOrder).ToList();
                if (parts is not null && request.PartIndex < parts.Count)
                {
                    imageUrl = ImageUrlHelper.LiveOrgImageUrl(
                        request.SessionId, parts[request.PartIndex].Content, "full");
                }

                break;
            }
            case ProjectItemType.BibleText:
            {
                if (item is not null && request.PartIndex < item.Parts.Count)
                {
                    text = item.Parts[request.PartIndex].Content;
                    credits = item.Title;
                }

                break;
            }
            case ProjectItemType.Audio:
                return null;
            case ProjectItemType.Slides:
            {
                if (item?.SourceId is { } slidesSourceId)
                {
                    var orderedParts = item.Parts.OrderBy(p => p.SortOrder).ToList();
                    if (request.PartIndex < orderedParts.Count
                        && int.TryParse(orderedParts[request.PartIndex].Content, out var pageIndex))
                    {
                        imageUrl = ImageUrlHelper.LiveSlidesPageUrl(
                            request.SessionId, slidesSourceId, pageIndex);
                    }
                }

                break;
            }
            default:
                return null;
        }

        return current with
        {
            Status = LiveSlideStatus.ShowingPresentation,
            ItemType = request.ItemType,
            ProjectItemId = request.ItemId,
            ItemPartIndex = request.PartIndex,
            Text = text,
            Credits = credits,
            ImageUrl = imageUrl,
            SongPart = songPart,
            Theme = request.Theme,
            SongId = songId,
            SongName = songName,
            CcliNumber = ccliNumber
        };
    }

    private Song? ResolveSong(LiveSlideRequest request, PresentationItem? item)
    {
        if (request.SourceId is not null)
        {
            var song = songService.GetSongById(request.SourceId, request.OrganizationId, request.Caller);
            if (song is not null) return song;
        }

        // Fallback: reconstruct from saved parts (legacy data)
        if (item is null || item.Parts.Count == 0) return null;

        return new Song(
            item.SourceId ?? item.Id,
            item.Title,
            null, null, null, null,
            item.Parts.Select(p => new SongPart("", null, null, null, p.Content)).ToList(),
            []);
    }

    public static string? FormatSongCredits(Song? song)
    {
        if (song is null) return null;
        var parts = new[]
            {
                song.Author,
                string.IsNullOrEmpty(song.Publisher) ? null : $"© {song.Publisher}",
                song.Year?.ToString()
            }
            .Where(s => !string.IsNullOrEmpty(s))
            .ToList();
        return parts.Count > 0 ? string.Join(" · ", parts) : null;
    }
}
