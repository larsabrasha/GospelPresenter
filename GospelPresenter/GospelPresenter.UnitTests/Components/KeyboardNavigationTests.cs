using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Components.Presentations;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The keyboard path through the presentation editor: the slide grid and the running order in the
/// sidebar. Both hold their own focus index, and both have to keep it pointing at something real
/// when the list changes underneath them.
/// </summary>
public class KeyboardNavigationTests : TestContext, IDisposable
{
    private const string SessionId = "session-1";
    private readonly SqliteConnection connection;
    private readonly PresentationEditorState editor = new();
    private readonly AppState appState = new() { SessionId = SessionId };
    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    private static readonly Song Song = new(
        "song-1", "O store Gud", null, null, null, null,
        [
            new SongPart("Vers 1", null, null, null, "O store Gud"),
            new SongPart("Refräng", null, null, null, "Då brister själen ut"),
            new SongPart("Vers 2", null, null, null, "När genom skogar")
        ],
        []);

    public KeyboardNavigationTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options;
        var factory = new TestDbContextFactory(options);
        using (var context = factory.CreateDbContext())
            context.Database.EnsureCreated();

        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        JSInterop.Mode = JSRuntimeMode.Loose;

        Services.AddSingleton(editor);
        Services.AddSingleton(appState);
        Services.AddSingleton(liveState);
        Services.AddSingleton(circuit);
        Services.AddSingleton(new ActiveOrganizationState());
        Services.AddSingleton(new KeyboardShortcutService());
        Services.AddSingleton<IPresentationService>(new PresentationService(factory, new StubObjectStorage()));
        Services.AddSingleton<IThemeService>(new ThemeService(factory));
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    private static ProjectItem Item(string id, string title) =>
        new() { Id = id, Title = title, Type = ProjectItemType.Song, SourceId = "song-1" };

    private void SelectSong()
    {
        var item = Item("item-1", "O store Gud");
        appState.SelectedProject = new Project { Id = "presentation-1", Name = "Sunday", Items = [item] };
        appState.SelectedProjectItem = item;
        editor.SelectedSong = Song;
    }

    private IRenderedComponent<SlideGrid> RenderGrid() =>
        RenderComponent<SlideGrid>(p => p
            .Add(c => c.SessionId, SessionId)
            .Add(c => c.PresentationId, "presentation-1"));

    // ---- Slide grid ---------------------------------------------------------------------------

    /// <summary>
    /// Guards the rest: a roving tabindex means exactly one tile is a Tab stop, and the arrows do
    /// the rest. If every tile were reachable by Tab, a long song would be a dozen presses deep.
    /// </summary>
    [Fact]
    public void SlideGrid_BeforeAnyArrowKey_OffersTheFirstTileAsTheOnlyTabStop()
    {
        SelectSong();

        var tabStops = RenderGrid().FindAll("[data-nav-index][tabindex='0']");

        tabStops.Count.ShouldBe(1);
        tabStops[0].GetAttribute("data-nav-index").ShouldBe("0");
    }

    /// <summary>
    /// The first press lands on the first tile rather than the second: before it, nothing was
    /// focused, and skipping the top tile would make it unreachable by keyboard.
    /// </summary>
    [Fact]
    public void SlideGrid_OnTheFirstArrowDown_LandsOnTheFirstTile()
    {
        SelectSong();
        var grid = RenderGrid();

        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        grid.Find("[data-nav-index][tabindex='0']").GetAttribute("data-nav-index").ShouldBe("0");
    }

    [Fact]
    public void SlideGrid_OnASecondArrowDown_MovesToTheNextTile()
    {
        SelectSong();
        var grid = RenderGrid();
        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        grid.Find("[data-nav-index][tabindex='0']").GetAttribute("data-nav-index").ShouldBe("1");
    }

    /// <summary>
    /// The tiles wrap by CSS, so the horizontal arrows have to step through them too — otherwise
    /// the second tile on a row would be unreachable.
    /// </summary>
    [Fact]
    public void SlideGrid_OnArrowRight_MovesToo()
    {
        SelectSong();
        var grid = RenderGrid();
        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowRight" });

        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowRight" });

        grid.Find("[data-nav-index][tabindex='0']").GetAttribute("data-nav-index").ShouldBe("1");
    }

    [Fact]
    public void SlideGrid_OnEnd_JumpsToTheLastTile()
    {
        SelectSong();
        var grid = RenderGrid();

        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "End" });

        grid.Find("[data-nav-index][tabindex='0']").GetAttribute("data-nav-index").ShouldBe("2");
    }

    [Fact]
    public void SlideGrid_OnArrowDownAtTheLastTile_StaysThere()
    {
        SelectSong();
        var grid = RenderGrid();
        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "End" });

        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        grid.Find("[data-nav-index][tabindex='0']").GetAttribute("data-nav-index").ShouldBe("2");
    }

    /// <summary>
    /// Moving is not showing. Enter is what puts a slide on the congregation's screens, so that
    /// scrolling past six verses does not broadcast all six.
    /// </summary>
    [Fact]
    public void SlideGrid_OnArrowDown_DoesNotSelectTheSlide()
    {
        SelectSong();
        var selected = false;
        var grid = RenderComponent<SlideGrid>(p => p
            .Add(c => c.SessionId, SessionId)
            .Add(c => c.PresentationId, "presentation-1")
            .Add(c => c.OnSelectSlide, _ => selected = true));

        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        selected.ShouldBeFalse();
    }

    [Fact]
    public void SlideGrid_OnClickingATile_SelectsTheSlide()
    {
        SelectSong();
        (string ItemId, int PartIndex)? selection = null;
        var grid = RenderComponent<SlideGrid>(p => p
            .Add(c => c.SessionId, SessionId)
            .Add(c => c.PresentationId, "presentation-1")
            .Add(c => c.OnSelectSlide, s => selection = s));

        grid.Find("[data-nav-index='1']").Click();

        selection.ShouldBe(("item-1", 1));
    }

    /// <summary>
    /// A different item means a different set of tiles. Leaving the index where it was would put
    /// the arrows halfway down a grid the operator has not looked at yet.
    /// </summary>
    [Fact]
    public void SlideGrid_WhenTheSelectedItemChanges_StartsOverAtTheFirstTile()
    {
        SelectSong();
        var grid = RenderGrid();
        grid.Find("#main").KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "End" });

        appState.SelectedProjectItem = Item("item-2", "Blott en dag");

        grid.Find("[data-nav-index][tabindex='0']").GetAttribute("data-nav-index").ShouldBe("0");
    }

    // ---- Running order ------------------------------------------------------------------------

    private IRenderedComponent<Sidebar> RenderSidebar(params ProjectItem[] items)
    {
        appState.SelectedProject = new Project { Id = "presentation-1", Name = "Sunday", Items = [.. items] };
        appState.SelectedProjectItem = items.FirstOrDefault();
        return RenderComponent<Sidebar>();
    }

    /// <summary>
    /// The running order selects as it moves, unlike the slide grid: that is what clicking a row
    /// does, and it is what an operator expects from a list of what comes next.
    /// </summary>
    [Fact]
    public void Sidebar_OnArrowDown_SelectsTheNextItem()
    {
        var sidebar = RenderSidebar(Item("item-1", "O store Gud"), Item("item-2", "Blott en dag"));

        sidebar.Find("#sidebar-item-list")
            .KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        appState.SelectedProjectItem!.Id.ShouldBe("item-2");
    }

    [Fact]
    public void Sidebar_OnArrowUpAtTheFirstItem_KeepsTheSelection()
    {
        var sidebar = RenderSidebar(Item("item-1", "O store Gud"), Item("item-2", "Blott en dag"));

        sidebar.Find("#sidebar-item-list")
            .KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowUp" });

        appState.SelectedProjectItem!.Id.ShouldBe("item-1");
    }

    [Fact]
    public void Sidebar_OnEnd_SelectsTheLastItem()
    {
        var sidebar = RenderSidebar(
            Item("item-1", "O store Gud"), Item("item-2", "Blott en dag"), Item("item-3", "Tryggare kan ingen vara"));

        sidebar.Find("#sidebar-item-list")
            .KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "End" });

        appState.SelectedProjectItem!.Id.ShouldBe("item-3");
    }

    [Fact]
    public void Sidebar_MarksTheSelectedItemAsTheTabStop()
    {
        var sidebar = RenderSidebar(Item("item-1", "O store Gud"), Item("item-2", "Blott en dag"));
        sidebar.Find("#sidebar-item-list")
            .KeyDown(new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown" });

        sidebar.Find("#sidebar-item-list [data-nav-index][tabindex='0']")
            .GetAttribute("data-nav-index").ShouldBe("1");
    }

    /// <summary>
    /// Ctrl+Down is the browser's, or a registered shortcut's. It must not move the running order
    /// as a side effect.
    /// </summary>
    [Fact]
    public void Sidebar_OnCtrlArrowDown_DoesNotMove()
    {
        var sidebar = RenderSidebar(Item("item-1", "O store Gud"), Item("item-2", "Blott en dag"));

        sidebar.Find("#sidebar-item-list").KeyDown(
            new Microsoft.AspNetCore.Components.Web.KeyboardEventArgs { Key = "ArrowDown", CtrlKey = true });

        appState.SelectedProjectItem!.Id.ShouldBe("item-1");
    }

    public new void Dispose()
    {
        connection.Dispose();
        base.Dispose();
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    /// <summary>Never reached: nothing in a render touches storage.</summary>
    private class StubObjectStorage : IObjectStorageService
    {
        public Task UploadAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<(Stream Stream, string ContentType)?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteByPrefixAsync(string prefix, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task CopyByPrefixAsync(string sourcePrefix, string destPrefix, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
