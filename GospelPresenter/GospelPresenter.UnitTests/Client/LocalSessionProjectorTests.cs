using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Live;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// Pins that a device applies a controller's command from its own state and its own database, with
/// no user interface involved.
///
/// This is the whole point of the class: being drivable has to depend on presenting and on nothing
/// else. When the applying code lived in the presentation page, a command that arrived while the
/// operator had navigated to another screen was dropped in silence, and the server's replica — and
/// with it every public output — moved on to a slide the projector was not showing.
/// </summary>
public class LocalSessionProjectorTests : IDisposable
{
    private const string SessionId = "e335721081dd";
    private const string OrganizationId = "org-1";
    private const string PresentationId = "presentation-1";
    private const string SongItemId = "item-song";
    private const string BibleItemId = "item-bible";
    private const string OverlayId = "overlay-1";

    private readonly SqliteConnection connection;
    private readonly SharedAppState state = new(TimeSpan.FromHours(4));
    private readonly PresentationService presentations;
    private readonly ThemeService themes;
    private readonly SongService songs;
    private readonly DeviceAuthService auth;
    private readonly string identityPath = Path.Combine(Path.GetTempPath(), $"identity-{Guid.NewGuid():N}.json");

    public LocalSessionProjectorTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var factory = new TestDbContextFactory(
            new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options);
        presentations = new PresentationService(factory, new StubObjectStorageService());
        themes = new ThemeService(factory);
        songs = new SongService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();
        context.Organizations.Add(new Organization { Id = OrganizationId, Name = "Org" });
        context.Presentations.Add(new Presentation
        {
            Id = PresentationId, Name = "Gudstjänst", OrganizationId = OrganizationId
        });
        context.PresentationItems.AddRange(
            new PresentationItem
            {
                Id = SongItemId, Title = "Amazing Grace", PresentationId = PresentationId,
                Type = PresentationItemType.Song, SourceId = "song-1", SortOrder = 0
            },
            new PresentationItem
            {
                Id = BibleItemId, Title = "Psalm 23", PresentationId = PresentationId,
                Type = PresentationItemType.BibleText, SortOrder = 1
            });
        context.PresentationItemParts.Add(new PresentationItemPart
        {
            Id = "part-bible-0", PresentationItemId = BibleItemId, Content = "The Lord is my shepherd", SortOrder = 0
        });
        context.OverlaySlides.Add(new OverlaySlide
        {
            Id = OverlayId, OrganizationId = OrganizationId, Title = "Welcome", Content = "Välkommen"
        });
        context.SaveChanges();

        auth = new DeviceAuthService(new FakeSecureTokenStore(), identityPath, NullLogger<DeviceAuthService>.Instance);
        auth.SignInAsync("gp_token", new DeviceIdentity(
            "user-1", "Operator", "operator@example.com", UserRole.Admin, OrganizationId, "Org", "device-1")).Wait();
    }

    public void Dispose()
    {
        connection.Dispose();
        if (File.Exists(identityPath)) File.Delete(identityPath);
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task ApplyAsync_PutsTheSelectionOnTheProjector_WithNoUiInvolved()
    {
        GoLive();

        await Projector().ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));

        var slide = state.GetLiveSlide(SessionId);
        slide.ProjectItemId.ShouldBe(BibleItemId);
        slide.ItemPartIndex.ShouldBe(0);
        slide.Status.ShouldBe(LiveSlideStatus.ShowingPresentation);
        slide.Text.ShouldBe("The Lord is my shepherd");
    }

    [Fact]
    public async Task ApplyAsync_IsAbsolute_SoTheSameCommandTwiceLandsInTheSamePlace()
    {
        GoLive();
        var command = new MirroredSessionCommand(BibleItemId, 0, false, null);

        await Projector().ApplyAsync(SessionId, command);
        var once = state.GetLiveSlide(SessionId);
        await Projector().ApplyAsync(SessionId, command);

        state.GetLiveSlide(SessionId).ShouldBe(once);
    }

    [Fact]
    public async Task ApplyAsync_WithBlackScreen_KeepsTheSelectionSoComingBackLandsOnTheSameSlide()
    {
        GoLive();
        var projector = Projector();

        await projector.ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));
        await projector.ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, true, null));

        var blacked = state.GetLiveSlide(SessionId);
        blacked.Status.ShouldBe(LiveSlideStatus.ShowingBlackScreen);
        blacked.ProjectItemId.ShouldBe(BibleItemId);

        await projector.ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));

        var back = state.GetLiveSlide(SessionId);
        back.Status.ShouldBe(LiveSlideStatus.ShowingPresentation);
        back.Text.ShouldBe("The Lord is my shepherd");
    }

    [Fact]
    public async Task ApplyAsync_SetsAndClearsTheOverlay()
    {
        GoLive();
        var projector = Projector();

        await projector.ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, OverlayId));
        state.GetActiveOverlay(SessionId)!.Id.ShouldBe(OverlayId);

        await projector.ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));
        state.GetActiveOverlay(SessionId).ShouldBeNull();
    }

    [Fact]
    public async Task ApplyAsync_ForASessionThatIsNotPresenting_DoesNothing()
    {
        // The operator stopped between the tap and its arrival. Not an error, and it must not
        // resurrect a session that is over.
        await Projector().ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));

        state.IsPresentationActive(SessionId).ShouldBeFalse();
        state.GetLiveSlide(SessionId).ShouldBe(SharedAppState.DefaultSlide);
    }

    [Fact]
    public async Task ApplyAsync_ForAnItemThisDeviceDoesNotHave_LeavesTheProjectorAlone()
    {
        GoLive();
        var projector = Projector();
        await projector.ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));
        var showing = state.GetLiveSlide(SessionId);

        await projector.ApplyAsync(SessionId, new MirroredSessionCommand("no-such-item", 0, false, null));

        state.GetLiveSlide(SessionId).ShouldBe(showing);
    }

    [Fact]
    public async Task ApplyAsync_RepeatingTheCurrentSelection_DoesNotRewriteTheLiveSlide()
    {
        // Writing restarts the CCLI clock, and absolute commands repeat by design — a resend after
        // reconnecting lands here. A song held on screen must not have its ten seconds reset.
        GoLive();
        var projector = Projector();
        var command = new MirroredSessionCommand(BibleItemId, 0, false, null);

        await projector.ApplyAsync(SessionId, command);

        var writes = 0;
        state.SessionChanged += change => { if (change.SessionId == SessionId) writes++; };
        await projector.ApplyAsync(SessionId, command);

        writes.ShouldBe(0);
    }

    [Fact]
    public async Task ApplyAsync_CountsCcliLocally_BecauseTheDeviceIsTheOneShowingTheSong()
    {
        // The exemption belongs on the server's replica, not here: this is the machine that
        // actually displayed the song, and its count is the one that syncs up.
        GoLive();

        await Projector().ApplyAsync(SessionId, new MirroredSessionCommand(BibleItemId, 0, false, null));

        state.IsCcliReportedElsewhere(SessionId).ShouldBeFalse();
    }

    private void GoLive() =>
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId, "Gudstjänst");

    private LocalSessionProjector Projector() =>
        new(state,
            new LiveSlideBuilder(songs),
            themes,
            auth,
            new SingleServiceScopeFactory(presentations),
            NullLogger<LocalSessionProjector>.Instance);

    private sealed class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }

    /// <summary>Hands out the one scoped service the projector reaches for.</summary>
    private sealed class SingleServiceScopeFactory(IPresentationService presentations)
        : IServiceScopeFactory, IServiceScope, IServiceProvider
    {
        public IServiceScope CreateScope() => this;
        public IServiceProvider ServiceProvider => this;

        public object? GetService(Type serviceType) =>
            serviceType == typeof(IPresentationService) ? presentations : null;

        public void Dispose() { }
    }

    private sealed class FakeSecureTokenStore : ISecureTokenStore
    {
        private string? token;

        public Task<string?> GetTokenAsync() => Task.FromResult(token);

        public Task SetTokenAsync(string value)
        {
            token = value;
            return Task.CompletedTask;
        }

        public Task RemoveTokenAsync()
        {
            token = null;
            return Task.CompletedTask;
        }
    }

    private sealed class StubObjectStorageService : IObjectStorageService
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
