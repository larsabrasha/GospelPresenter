using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Pins what a selection turns into, because two hosts now have to agree on it: the operator's own
/// machine builds the slide from its local database, and the server rebuilds the same slide from
/// the selection that machine echoes up. A difference between the two shows up as the projector
/// and the congregation's screens disagreeing mid-service.
/// </summary>
public class LiveSlideBuilderTests
{
    private const string SessionId = "sess1234";
    private const string OrganizationId = "org-1";
    private const string ItemId = "item-1";

    private static readonly CallerContext Caller = new("user-1", UserRole.Admin, OrganizationId);
    private static readonly LiveSlide Blank = SharedAppState.DefaultSlide;

    // ---------- songs ----------

    [Fact]
    public void Build_ForASongInTheLibrary_TakesTheTextFromTheLibraryPart()
    {
        var song = new Song("song-1", "Amazing Grace", "John Newton", "Olney", 1779, "12345",
            [Part("p1", "Amazing grace"), Part("p2", "Twas grace that taught")], []);
        var builder = BuilderWith(song);
        var presentation = PresentationWith(Item(PresentationItemType.Song, sourceId: "song-1"));

        var slide = builder.Build(Blank, Request(presentation, ProjectItemType.Song, "song-1", partIndex: 1));

        slide.ShouldNotBeNull();
        slide.Status.ShouldBe(LiveSlideStatus.ShowingPresentation);
        slide.ItemType.ShouldBe(ProjectItemType.Song);
        slide.ProjectItemId.ShouldBe(ItemId);
        slide.ItemPartIndex.ShouldBe(1);
        slide.Text.ShouldBe("Twas grace that taught");
        slide.SongPart!.Content.ShouldBe("Twas grace that taught");
        slide.SongId.ShouldBe("song-1");
        slide.SongName.ShouldBe("Amazing Grace");
        slide.CcliNumber.ShouldBe("12345");
        slide.Credits.ShouldBe("John Newton · © Olney · 1779");
    }

    [Fact]
    public void Build_ForASong_FollowsTheArrangementSavedOnThePresentationItem()
    {
        var song = new Song("song-1", "Amazing Grace", null, null, null, null,
            [Part("p1", "First"), Part("p2", "Second")],
            [new SongArrangement("arr-1", "Reversed", ["p2", "p1"])]);
        var builder = BuilderWith(song);
        var item = Item(PresentationItemType.Song, sourceId: "song-1");
        item.ArrangementId = "arr-1";

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.Song, "song-1", 0));

        slide!.Text.ShouldBe("Second");
    }

    [Fact]
    public void Build_ForASong_FallsBackToTheArrangementFirstListedOnTheSong()
    {
        var song = new Song("song-1", "Amazing Grace", null, null, null, null,
            [Part("p1", "First"), Part("p2", "Second")],
            [new SongArrangement("arr-1", "Reversed", ["p2", "p1"])]);
        var builder = BuilderWith(song);

        var slide = builder.Build(Blank, Request(
            PresentationWith(Item(PresentationItemType.Song, sourceId: "song-1")),
            ProjectItemType.Song, "song-1", 0));

        slide!.Text.ShouldBe("Second");
    }

    [Fact]
    public void Build_ForASongMissingFromTheLibrary_ReconstructsItFromTheSavedParts()
    {
        // Legacy data: the presentation kept its own copy of the lyrics before songs had ids.
        var builder = BuilderWith();
        var item = Item(PresentationItemType.Song, sourceId: "gone", title: "Old Hymn",
            parts: [("Verse one", 0), ("Verse two", 1)]);

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.Song, "gone", 1));

        slide!.Text.ShouldBe("Verse two");
        slide.SongName.ShouldBe("Old Hymn");
        slide.SongId.ShouldBe("gone");
        slide.CcliNumber.ShouldBeNull();
        slide.Credits.ShouldBeNull();
    }

    [Fact]
    public void Build_ForASongPartThatDoesNotExist_StillMovesTheSlideButLeavesTheSongFieldsEmpty()
    {
        var song = new Song("song-1", "Amazing Grace", null, null, null, null, [Part("p1", "Only part")], []);
        var builder = BuilderWith(song);

        var slide = builder.Build(Blank, Request(
            PresentationWith(Item(PresentationItemType.Song, sourceId: "song-1")),
            ProjectItemType.Song, "song-1", partIndex: 7));

        slide.ShouldNotBeNull();
        slide.ItemPartIndex.ShouldBe(7);
        slide.Text.ShouldBeNull();
        slide.SongPart.ShouldBeNull();
        slide.SongId.ShouldBeNull();
    }

    // ---------- other item types ----------

    [Fact]
    public void Build_ForAnImage_PointsAtTheSessionsLiveImageUrlInSortOrder()
    {
        var builder = BuilderWith();
        var item = Item(PresentationItemType.Image, parts: [("image-b", 1), ("image-a", 0)]);

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.Image, null, 1));

        slide!.ImageUrl.ShouldBe(ImageUrlHelper.LiveOrgImageUrl(SessionId, "image-b", "full"));
        slide.Text.ShouldBeNull();
    }

    [Fact]
    public void Build_ForBibleText_TakesTheTextFromThePartAndTheCreditFromTheTitle()
    {
        var builder = BuilderWith();
        var item = Item(PresentationItemType.BibleText, title: "Psalm 23:1-2",
            parts: [("The Lord is my shepherd", 0), ("He makes me lie down", 1)]);

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.BibleText, null, 0));

        slide!.Text.ShouldBe("The Lord is my shepherd");
        slide.Credits.ShouldBe("Psalm 23:1-2");
    }

    [Fact]
    public void Build_ForAudio_ReturnsNothingSoWhateverIsShowingStays()
    {
        var builder = BuilderWith();
        var item = Item(PresentationItemType.Audio, parts: [("audio-1|track.mp3", 0)]);

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.Audio, null, 0));

        slide.ShouldBeNull();
    }

    [Fact]
    public void Build_ForImportedSlides_PointsAtThePageTheSelectedPartNames()
    {
        var builder = BuilderWith();
        var item = Item(PresentationItemType.Slides, sourceId: "deck-1", parts: [("4", 0), ("5", 1)]);

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.Slides, "deck-1", 1));

        slide!.ImageUrl.ShouldBe(ImageUrlHelper.LiveSlidesPageUrl(SessionId, "deck-1", 5));
    }

    [Fact]
    public void Build_ForImportedSlidesWithAnUnparseablePage_LeavesTheSlideWithoutAnImage()
    {
        var builder = BuilderWith();
        var item = Item(PresentationItemType.Slides, sourceId: "deck-1", parts: [("not-a-page", 0)]);

        var slide = builder.Build(Blank, Request(PresentationWith(item), ProjectItemType.Slides, "deck-1", 0));

        slide!.ImageUrl.ShouldBeNull();
    }

    // ---------- shape of the result ----------

    [Fact]
    public void Build_CarriesTheThemeOntoTheSlide()
    {
        var theme = new SlideTheme();
        var builder = BuilderWith();
        var item = Item(PresentationItemType.BibleText, parts: [("A verse", 0)]);

        var slide = builder.Build(Blank, Request(
            PresentationWith(item), ProjectItemType.BibleText, null, 0, theme));

        slide!.Theme.ShouldBeSameAs(theme);
    }

    [Fact]
    public void Build_FromABlackedOutScreen_TurnsThePresentationBackOn()
    {
        var builder = BuilderWith();
        var item = Item(PresentationItemType.BibleText, parts: [("A verse", 0)]);
        var blackedOut = Blank with { Status = LiveSlideStatus.ShowingBlackScreen };

        var slide = builder.Build(blackedOut, Request(PresentationWith(item), ProjectItemType.BibleText, null, 0));

        slide!.Status.ShouldBe(LiveSlideStatus.ShowingPresentation);
    }

    [Fact]
    public void Build_WithoutALoadedPresentation_StillResolvesASongFromTheLibrary()
    {
        // The page reaches for the presentation defensively, and a song does not need it.
        var song = new Song("song-1", "Amazing Grace", null, null, null, null, [Part("p1", "Amazing grace")], []);
        var builder = BuilderWith(song);

        var slide = builder.Build(Blank, new LiveSlideRequest(
            SessionId, OrganizationId, ItemId, ProjectItemType.Song, "song-1", 0, null, null, Caller));

        slide!.Text.ShouldBe("Amazing grace");
    }

    // ---------- ForItem ----------

    [Fact]
    public void ForItem_ReadsTheTypeAndSourceFromThePresentation()
    {
        var presentation = PresentationWith(Item(PresentationItemType.Slides, sourceId: "deck-1"));

        var request = LiveSlideRequest.ForItem(
            SessionId, OrganizationId, presentation, ItemId, 0, null, Caller);

        request.ShouldNotBeNull();
        request.ItemType.ShouldBe(ProjectItemType.Slides);
        request.SourceId.ShouldBe("deck-1");
    }

    [Fact]
    public void ForItem_ForAnItemThePresentationDoesNotHave_ReturnsNothing()
    {
        var presentation = PresentationWith(Item(PresentationItemType.Song));

        var request = LiveSlideRequest.ForItem(
            SessionId, OrganizationId, presentation, "no-such-item", 0, null, Caller);

        request.ShouldBeNull();
    }

    // ---------- credits ----------

    [Theory]
    [InlineData("John Newton", "Olney", 1779, "John Newton · © Olney · 1779")]
    [InlineData("John Newton", null, null, "John Newton")]
    [InlineData(null, "Olney", null, "© Olney")]
    [InlineData(null, null, 1779, "1779")]
    [InlineData(null, "", null, null)]
    [InlineData(null, null, null, null)]
    public void FormatSongCredits_JoinsWhateverTheSongActuallyHas(
        string? author, string? publisher, int? year, string? expected)
    {
        var song = new Song("song-1", "Name", author, publisher, year, null, [], []);

        LiveSlideBuilder.FormatSongCredits(song).ShouldBe(expected);
    }

    [Fact]
    public void FormatSongCredits_ForNoSong_ReturnsNothing()
    {
        LiveSlideBuilder.FormatSongCredits(null).ShouldBeNull();
    }

    // ---------- helpers ----------

    private static LiveSlideBuilder BuilderWith(params Song[] songs) =>
        new(new StubSongService(songs));

    private static SongPart Part(string id, string content) => new(id, null, null, null, content);

    private static PresentationItem Item(
        PresentationItemType type,
        string? sourceId = null,
        string title = "",
        (string Content, int SortOrder)[]? parts = null)
    {
        return new PresentationItem
        {
            Id = ItemId,
            SourceId = sourceId,
            Type = type,
            Title = title,
            Parts = (parts ?? [])
                .Select(p => new PresentationItemPart { Content = p.Content, SortOrder = p.SortOrder })
                .ToList()
        };
    }

    private static Presentation PresentationWith(PresentationItem item) =>
        new() { Id = "pres-1", OrganizationId = OrganizationId, Items = [item] };

    private static LiveSlideRequest Request(
        Presentation presentation,
        ProjectItemType type,
        string? sourceId,
        int partIndex,
        SlideTheme? theme = null) =>
        new(SessionId, OrganizationId, ItemId, type, sourceId, partIndex, presentation, theme, Caller);

    private class StubSongService(Song[] songs) : ISongService
    {
        public Song? GetSongById(string id, string organizationId, CallerContext caller) =>
            songs.FirstOrDefault(s => s.Id == id);

        public IReadOnlyList<Song> GetSongsByOrganization(string organizationId, CallerContext caller) => songs;

        public IReadOnlyList<Song> SearchByOrganization(string query, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task LoadSongsAsync() => throw new NotSupportedException();

        public Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, CallerContext caller, bool replaceExisting = false) =>
            throw new NotSupportedException();

        public Task DeleteSongAsync(string id, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task<List<TrashedSong>> GetTrashedSongsAsync(string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task RestoreFromTrashAsync(string id, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task PermanentlyDeleteSongAsync(string id, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task EmptyTrashAsync(string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task RestoreAllFromTrashAsync(string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task UpdateSongAsync(string id, string organizationId, string name, string? author, string? publisher, int? year, string? ccli, CallerContext caller) =>
            throw new NotSupportedException();

        public Task UpdateSongPartAsync(string songId, string organizationId, int partIndex, string? labelId, string content, CallerContext caller) =>
            throw new NotSupportedException();

        public Task UpdateSongPartsAsync(string songId, string organizationId, IReadOnlyDictionary<int, (string? LabelId, string Content)> edits, CallerContext caller) =>
            throw new NotSupportedException();

        public Task AddSongPartAsync(string songId, string organizationId, string? labelId, string content, CallerContext caller) =>
            throw new NotSupportedException();

        public Task DeleteSongPartAsync(string songId, string organizationId, int partIndex, CallerContext caller) =>
            throw new NotSupportedException();

        public Task MoveSongPartAsync(string songId, string organizationId, int fromIndex, int toIndex, CallerContext caller) =>
            throw new NotSupportedException();

        public Task<List<SongVersionSummary>> GetVersionsAsync(string songId, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task<SongVersionDetail?> GetVersionAsync(string versionId, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task RestoreVersionAsync(string songId, string organizationId, string versionId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task<Song> CreateSongAsync(string name, string? author, string? publisher, int? year, string? ccli, List<SongPart> parts, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();

        public Task CreateSongArrangementAsync(string songId, string organizationId, string? name, IList<string> partIds, CallerContext caller) =>
            throw new NotSupportedException();

        public Task UpdateSongArrangementAsync(string songId, string organizationId, string arrangementId, string? name, IList<string> partIds, CallerContext caller) =>
            throw new NotSupportedException();

        public Task DeleteSongArrangementAsync(string songId, string organizationId, string arrangementId, CallerContext caller) =>
            throw new NotSupportedException();
    }
}
