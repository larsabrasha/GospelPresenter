using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Components.Presentations.AddItem;
using GospelPresenter.Shared.Components.Presentations.AddItem.Bible;
using GospelPresenter.Shared.Components.Presentations.AddItem.Song;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// What the add-item tabs leave behind when the modal stays open. "Add more" means the user is
/// adding a second thing, and the second thing is almost never the one still in the search box —
/// leaving the old query there costs a select-all and a delete before every add.
/// </summary>
public class AddItemSearchResetTests : TestContext
{
    private const string OrganizationId = "org-1";

    public AddItemSearchResetTests()
    {
        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        JSInterop.Mode = JSRuntimeMode.Loose;

        var orgState = new ActiveOrganizationState();
        orgState.Initialize("user-1", UserRole.Admin, OrganizationId);

        Services.AddSingleton(circuit);
        Services.AddSingleton(orgState);
        Services.AddSingleton(new AppState());
        Services.AddSingleton<ISongService>(new TestSongService([Majestat, HogstAvAllt]));
        Services.AddSingleton<IBibleService>(new TestBibleService());
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    [Fact]
    public void SongTab_AfterAddingWithAddMoreOn_TheSearchBoxIsEmptyAgain()
    {
        var addMore = new AddMoreToggle { Value = true };
        var tab = RenderSongTab(addMore);

        Search(tab, "Majestät");
        tab.FindAll("[data-song-list] button").Count.ShouldBe(1);

        ClickAdd(tab);

        SearchBox(tab).GetAttribute("value").ShouldBeNullOrEmpty();
        tab.FindAll("[data-song-list] button").Count.ShouldBe(2);
    }

    [Fact]
    public void SongTab_AfterShiftEnter_TheSearchBoxIsEmptyAgain()
    {
        // Shift+Enter keeps the modal open whatever the checkbox says.
        var tab = RenderSongTab(new AddMoreToggle { Value = false });

        Search(tab, "Majestät");
        tab.Find("div.flex.flex-col.h-full").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "Enter", ShiftKey = true });

        SearchBox(tab).GetAttribute("value").ShouldBeNullOrEmpty();
    }

    [Fact]
    public void SongTab_AfterAddingWithAddMoreOff_TheSearchIsLeftAlone()
    {
        // The modal is closing; re-running the search would only churn.
        var tab = RenderSongTab(new AddMoreToggle { Value = false });

        Search(tab, "Majestät");
        ClickAdd(tab);

        SearchBox(tab).GetAttribute("value").ShouldBe("Majestät");
    }

    [Fact]
    public void BibleTab_AfterAddingWithAddMoreOn_TheSearchBoxIsEmptyAgain()
    {
        var addMore = new AddMoreToggle { Value = true };
        var tab = RenderComponent<BibleTextTab>(p => p.Add(t => t.AddMoreState, addMore));

        Search(tab, "Joh 3:16");
        ClickAdd(tab);

        SearchBox(tab).GetAttribute("value").ShouldBeNullOrEmpty();
    }

    private IRenderedComponent<SongTab> RenderSongTab(AddMoreToggle addMore) =>
        RenderComponent<SongTab>(p => p.Add(t => t.AddMoreState, addMore));

    private static void Search<T>(IRenderedComponent<T> tab, string query) where T : Microsoft.AspNetCore.Components.IComponent =>
        SearchBox(tab).Input(query);

    private static AngleSharp.Dom.IElement SearchBox<T>(IRenderedComponent<T> tab) where T : Microsoft.AspNetCore.Components.IComponent =>
        tab.Find("input[type=text]");

    private static void ClickAdd<T>(IRenderedComponent<T> tab) where T : Microsoft.AspNetCore.Components.IComponent =>
        tab.FindAll("button").First(b => b.TextContent.Contains("Lägg till") && !b.TextContent.Contains("fler")).Click();

    private static readonly Song Majestat = MakeSong("Majestät", "Jan Honningdal", "Majestät, Konung i evighet.");
    private static readonly Song HogstAvAllt = MakeSong("Högst av allt", "Bengt Johansson", "Högt över världen och mänsklig makt");

    private static Song MakeSong(string name, string? author, params string[] parts) =>
        new(Guid.NewGuid().ToString(), name, author, null, null, null,
            parts.Select(p => new SongPart("", null, null, null, p)).ToList(), [], OrganizationId);

    private class TestSongService : SongService
    {
        public TestSongService(Song[] songs) : base(null!) => LoadTestSongs(songs);
    }

    private class TestBibleService : IBibleService
    {
        private static readonly Verse Verse = new("JHN", 3, 16, "Så älskade Gud världen...");

        public IReadOnlyList<Bible> GetBibles(string organizationId) => [new("b1", "Test", [Verse])];
        public IEnumerable<Verse> Search(string organizationId, string bibleId, string query) => [Verse];
        public IReadOnlyList<string> GetBooks(string organizationId, string bibleId) => ["JHN"];
        public IReadOnlyList<int> GetChapters(string organizationId, string bibleId, string bookId) => [3];
        public IReadOnlyList<Verse> GetVerses(string organizationId, string bibleId, string bookId, int chapter) => [Verse];
        public Task LoadBiblesAsync() => Task.CompletedTask;
        public Task<ImportBibleResult> ImportBibleAsync(Stream zipStream, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();
        public Task DeleteBibleAsync(string bibleId, string organizationId, CallerContext caller) =>
            throw new NotSupportedException();
    }
}
