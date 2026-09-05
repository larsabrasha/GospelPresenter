using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Pages.SuperAdmin;
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
/// The superadmin's view of everything that is running, and the one button on it that does
/// something: ending a live session by hand.
///
/// It exists because nothing else could reach some of them. A presentation owned by a device that
/// has gone away is ended by the reaper eventually and by its own controller if somebody is holding
/// one, but neither is any use to the person who wants to know, right now, what this server thinks
/// is live — and a list you cannot act on answers half the question.
///
/// Rendered directly rather than routed to, which skips the layout and the authorization attribute.
/// Both matter and neither is tested here: the attribute is the same one the organisations page
/// carries, and the layout hides every page's body until the browser has handed it a session id,
/// which no test has.
/// </summary>
public class LiveSessionsRenderTests : TestContext, IDisposable
{
    private const string OrganizationId = "org-1";
    private const string SessionId = "session-1";

    private readonly SqliteConnection connection;
    private readonly SharedAppState liveState = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);
    private readonly StubEnder ender = new();

    public LiveSessionsRenderTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options;
        var factory = new TestDbContextFactory(options);
        using (var context = factory.CreateDbContext())
        {
            context.Database.EnsureCreated();
            context.Organizations.Add(new Organization { Id = OrganizationId, Name = "Betelkyrkan" });
            context.SaveChanges();
        }

        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        var orgState = new ActiveOrganizationState();
        orgState.Initialize("user-1", UserRole.SuperAdmin, OrganizationId);

        Services.AddSingleton(circuit);
        Services.AddSingleton(liveState);
        Services.AddSingleton<RemoteDisplayState>();
        Services.AddSingleton(orgState);
        Services.AddSingleton<ILiveSessionEnder>(ender);
        Services.AddSingleton<IUserService>(
            new UserService(factory, new SongPartLabelService(factory)));
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));

        // The confirmation dialog reaches for showModal. Loose because nothing here depends on
        // what the browser does with it.
        JSInterop.Mode = JSRuntimeMode.Loose;
    }

    [Fact]
    public void WithNothingRunning_ShowsTheEmptyState()
    {
        var page = RenderComponent<LiveSessions>();

        page.Markup.ShouldContain("Ingen presenterar just nu");
    }

    [Fact]
    public void WithAPresentationRunning_ListsItUnderItsOrganizationsName()
    {
        liveState.ActivatePresentation(SessionId, OrganizationId, "pres-1", "Söndagsgudstjänst");

        var page = RenderComponent<LiveSessions>();

        page.Markup.ShouldContain("Söndagsgudstjänst");
        page.Markup.ShouldContain("Betelkyrkan");
        page.Markup.ShouldContain(SessionId);
    }

    /// <summary>
    /// The reason the accessor behind this deliberately filters nothing: a live service nobody can
    /// account for is exactly what somebody comes here to find, and it will not be in the
    /// organisation they happen to be looking at.
    /// </summary>
    [Fact]
    public void WithAPresentationInAnotherOrganization_ListsThatToo()
    {
        liveState.ActivatePresentation("session-2", "some-other-org", "pres-2", "Kvällsmöte");

        var page = RenderComponent<LiveSessions>();

        page.Markup.ShouldContain("Kvällsmöte");
    }

    /// <summary>
    /// Ending somebody else's service is confirmed rather than immediate, the same way taking over
    /// a public output is: nobody is standing next to that congregation to notice a misclick.
    /// </summary>
    [Fact]
    public void ClickingEnd_AsksFirstAndLeavesTheSessionRunning()
    {
        liveState.ActivatePresentation(SessionId, OrganizationId, "pres-1", "Söndagsgudstjänst");
        var page = RenderComponent<LiveSessions>();

        page.FindAll("button").First(b => b.TextContent.Contains("Avsluta")).Click();

        page.Markup.ShouldContain("Avsluta presentationen?");
        liveState.IsPresentationActive(SessionId).ShouldBeTrue();
        ender.Ended.ShouldBeEmpty();
    }

    /// <summary>
    /// And confirming ends it through the same path a device's own Stop takes, which is what also
    /// releases the screens and public outputs it was holding.
    /// </summary>
    [Fact]
    public void ConfirmingTheEnd_EndsTheSessionThroughTheOrdinaryPath()
    {
        liveState.ActivatePresentation(SessionId, OrganizationId, "pres-1", "Söndagsgudstjänst");
        var page = RenderComponent<LiveSessions>();
        page.FindAll("button").First(b => b.TextContent.Contains("Avsluta")).Click();

        page.FindAll("button").Last(b => b.TextContent.Contains("Avsluta")).Click();

        ender.Ended.ShouldBe([SessionId]);
        page.Markup.ShouldNotContain("Avsluta presentationen?");
    }

    /// <summary>
    /// A session that stops somewhere else — its own operator, the reaper, a controller — takes its
    /// row with it without anybody refreshing the page.
    /// </summary>
    [Fact]
    public void WhenASessionStopsElsewhere_TheRowGoes()
    {
        liveState.ActivatePresentation(SessionId, OrganizationId, "pres-1", "Söndagsgudstjänst");
        var page = RenderComponent<LiveSessions>();
        page.Markup.ShouldContain("Söndagsgudstjänst");

        liveState.DeactivatePresentation(SessionId);

        page.WaitForAssertion(() => page.Markup.ShouldContain("Ingen presenterar just nu"));
    }

    public new void Dispose()
    {
        connection.Dispose();
        base.Dispose();
    }

    /// <summary>
    /// Stands in for the web host's projector, which is where ending a session really happens. What
    /// matters here is that the page reaches for it rather than deactivating the session behind its
    /// back, so this records the call and nothing else.
    /// </summary>
    private sealed class StubEnder : ILiveSessionEnder
    {
        public List<string> Ended { get; } = [];

        public void End(string sessionId) => Ended.Add(sessionId);
    }

    private sealed class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
