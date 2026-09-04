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
/// Why the presentation editor is split into components that inject their state instead of one page
/// that hands it down.
///
/// Blazor skips a child whose parameters it can prove unchanged, but the proof only holds for types
/// it knows to be immutable. Everything this editor passes around is a record or a list, so a child
/// taking them as parameters is rebuilt on every render of its parent — including renders caused by
/// something it does not show, like a modal opening or a title being typed. A child that injects the
/// state and listens for the properties it reads is rebuilt only when one of them changes.
///
/// These tests are the measurement behind that choice. They fail if the grid goes back to taking
/// parameters, and they fail if it starts listening to more than it reads.
/// </summary>
public class PresentationRenderTests : TestContext, IDisposable
{
    private const string SessionId = "session-1";
    private readonly SqliteConnection connection;
    private readonly PresentationEditorState editor = new();
    private readonly AppState appState = new() { SessionId = SessionId };
    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    private static readonly Song Song = new(
        "song-1", "O store Gud", null, null, null, null,
        [new SongPart("Vers", null, null, null, "O store Gud, när jag den värld beskådar")],
        []);

    public PresentationRenderTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options;
        var factory = new TestDbContextFactory(options);
        using (var context = factory.CreateDbContext())
            context.Database.EnsureCreated();

        var item = new ProjectItem
        {
            Id = "item-1", Title = "O store Gud", Type = ProjectItemType.Song, SourceId = "song-1"
        };
        appState.SelectedProject = new Project { Id = "presentation-1", Name = "Sunday", Items = [item] };
        appState.SelectedProjectItem = item;

        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        Services.AddSingleton(editor);
        Services.AddSingleton(appState);
        Services.AddSingleton(liveState);
        Services.AddSingleton(circuit);
        Services.AddSingleton(new ActiveOrganizationState());
        Services.AddSingleton<IPresentationService>(new PresentationService(factory, new StubObjectStorage()));
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    /// <summary>Guards the rest: they prove nothing unless the grid renders the selection at all.</summary>
    [Fact]
    public void SlideGrid_WithASongSelected_RendersItsParts()
    {
        editor.SelectedSong = Song;

        RenderGrid().Markup.ShouldContain("O store Gud, när jag den värld beskådar");
    }

    [Fact]
    public void SlideGrid_WhenTheSelectionChanges_Repaints()
    {
        var grid = RenderGrid();
        var before = grid.RenderCount;

        editor.SelectedSong = Song;

        grid.RenderCount.ShouldBe(before + 1);
    }

    [Fact]
    public void SlideGrid_WhenTheLiveSlideMoves_Repaints()
    {
        editor.SelectedSong = Song;
        var grid = RenderGrid();
        var before = grid.RenderCount;

        liveState.SetLiveSlide(SessionId, SharedAppState.DefaultSlide with { ProjectItemId = "item-1", ItemPartIndex = 0 });

        grid.RenderCount.ShouldBe(before + 1);
    }

    /// <summary>
    /// The half that pays for the split. The live panel's list of screens is held in the same state
    /// object, and the grid does not show it, so changing it must not reach the grid at all.
    /// </summary>
    [Fact]
    public void SlideGrid_WhenSomethingItDoesNotShowChanges_DoesNotRepaint()
    {
        var grid = RenderGrid();
        var before = grid.RenderCount;

        editor.SavedDisplays = [new RemoteDisplay { DisplayIdentifier = "screen-1", Name = "Stora salen" }];

        grid.RenderCount.ShouldBe(before);
    }

    /// <summary>
    /// And the other half: another session going live is somebody else's business. Before the
    /// notification carried a session id anyone could compare, this repainted every open editor.
    /// </summary>
    [Fact]
    public void SlideGrid_WhenAnotherSessionsSlideMoves_DoesNotRepaint()
    {
        var grid = RenderGrid();
        var before = grid.RenderCount;

        liveState.SetLiveSlide("someone-elses-session", SharedAppState.DefaultSlide with { ProjectItemId = "item-9" });

        grid.RenderCount.ShouldBe(before);
    }

    private IRenderedComponent<SlideGrid> RenderGrid() =>
        RenderComponent<SlideGrid>(p => p
            .Add(c => c.SessionId, SessionId)
            .Add(c => c.PresentationId, "presentation-1"));

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
