using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Shouldly;
using PresentationPage = GospelPresenter.Shared.Pages.Presentation;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// What a change to the live slide is allowed to do to the surface watching it.
///
/// The live slide is shared: whoever moves it — the operator, a phone driving the machine, a second
/// person on the same service — moves it for everyone, because it is what the congregation sees.
/// The selection is not. It is where each person happens to be looking, and looking ahead at the
/// next song while someone else advances this one is the whole reason for a second surface.
///
/// Stage mode is the one exception, and it is not really an exception: it is a view of what is
/// showing and has no separate selection to lose.
/// </summary>
public class LiveSelectionFollowTests : TestContext, IDisposable
{
    private const string SessionId = "session-1";
    private const string OrganizationId = "org-1";
    private const string PresentationId = "presentation-1";

    private readonly SqliteConnection connection;
    private readonly PresentationEditorState editor = new();
    private readonly AppState appState = new() { SessionId = SessionId };
    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    public LiveSelectionFollowTests()
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

        Services.AddLogging();
        Services.AddSingleton(editor);
        Services.AddSingleton(appState);
        Services.AddSingleton(liveState);
        Services.AddSingleton(circuit);
        var orgState = new ActiveOrganizationState();
        orgState.Initialize("user-1", UserRole.Admin, OrganizationId);
        Services.AddSingleton(orgState);
        Services.AddSingleton(new KeyboardShortcutService());
        Services.AddSingleton(new ToastService());
        Services.AddSingleton<IStatusBarService>(new FlatStatusBar());
        Services.AddSingleton<IPresentationService>(new PresentationService(factory, new StubObjectStorage()));
        Services.AddSingleton<IThemeService>(new ThemeService(factory));
        Services.AddSingleton<IAppCapabilities>(new FullAppCapabilities());
        Services.AddSingleton<RemoteDisplayState>();
        Services.AddSingleton(new PublicOutputState(500));
        Services.AddSingleton<LiveOutputsState>();
        Services.AddSingleton<IRemoteDisplayService>(new RemoteDisplayService(factory));
        Services.AddSingleton<IBibleTextService>(new BibleTextService());
        var songs = new SongService(factory);
        Services.AddSingleton<ISongService>(songs);
        Services.AddSingleton<ILiveSlideBuilder>(new LiveSlideBuilder(songs));
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    /// <summary>
    /// The case the operator's own machine is in while a phone drives it, and the case a second
    /// person on the same service is in. Neither asked to be moved.
    /// </summary>
    [Fact]
    public void WhenSomethingElseMovesTheLiveSlideToAnotherItem_TheSelectionStaysWhereItWas()
    {
        var page = RenderPage(stage: false);

        MoveTheLiveSlideTo("item-2");

        appState.SelectedProjectItem?.Id.ShouldBe("item-1");
        page.ShouldNotBeNull();
    }

    /// <summary>Moving within the same item was never followed, and still is not.</summary>
    [Fact]
    public void WhenSomethingElseMovesTheLiveSlideWithinTheSelectedItem_TheSelectionStaysWhereItWas()
    {
        RenderPage(stage: false);

        MoveTheLiveSlideTo("item-1", partIndex: 3);

        appState.SelectedProjectItem?.Id.ShouldBe("item-1");
    }

    /// <summary>Stage mode has nothing to protect: it shows what is live and nothing else.</summary>
    [Fact]
    public void InStageMode_TheSelectionFollowsTheLiveSlide()
    {
        RenderPage(stage: true);

        MoveTheLiveSlideTo("item-2");

        appState.SelectedProjectItem?.Id.ShouldBe("item-2");
    }

    private IRenderedComponent<PresentationPage> RenderPage(bool stage)
    {
        var items = new List<ProjectItem>
        {
            new() { Id = "item-1", Title = "O store Gud", Type = ProjectItemType.BibleText },
            new() { Id = "item-2", Title = "Blott en dag", Type = ProjectItemType.BibleText }
        };
        appState.SelectedProject = new Project { Id = PresentationId, Name = "Sunday", Items = items };
        appState.SelectedProjectItem = items[0];

        liveState.ActivatePresentation(SessionId, OrganizationId, PresentationId, "Sunday");

        // Stage is a query parameter, and bUnit only supplies those through the address bar.
        Services.GetRequiredService<NavigationManager>()
            .NavigateTo($"/presentations/{PresentationId}{(stage ? "?stage=true" : "")}");

        var page = RenderComponent<PresentationPage>(p => p
            .Add(c => c.PresentationId, PresentationId));

        // The page loads the presentation from the database on first render, and there is none
        // there — it clears the selection when that happens. Put the running order back, so what
        // the tests measure is the live slide's effect on it and not the empty database's.
        appState.SelectedProject = new Project { Id = PresentationId, Name = "Sunday", Items = items };
        appState.SelectedProjectItem = items[0];

        return page;
    }

    private void MoveTheLiveSlideTo(string itemId, int partIndex = 0) =>
        liveState.SetLiveSlide(SessionId, new LiveSlide(
            LiveSlideStatus.ShowingPresentation,
            ProjectItemType.BibleText,
            itemId,
            partIndex,
            "Text",
            null,
            null,
            null));

    private sealed class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    private sealed class FlatStatusBar : IStatusBarService
    {
        public int GetStatusBarHeight() => 0;
    }

    /// <summary>Never reached: nothing in a render touches storage.</summary>
    private sealed class StubObjectStorage : IObjectStorageService
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

    public new void Dispose()
    {
        connection.Dispose();
        base.Dispose();
        GC.SuppressFinalize(this);
    }
}
