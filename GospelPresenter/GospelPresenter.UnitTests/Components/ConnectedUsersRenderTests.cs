using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Contexts;
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
/// Who has the app open, as the superadmin sees it.
///
/// The page is a window onto <c>ConnectedUserRegistry</c>, which is where the counting is tested.
/// What is worth holding here is what the page does with the answer: one row per person, the
/// organisation spelled out, and a dropped connection said rather than hidden — because the
/// difference between "left" and "lid closed" is the whole reason the row stays.
/// </summary>
public class ConnectedUsersRenderTests : TestContext, IDisposable
{
    private const string OrganizationId = "org-1";

    private readonly SqliteConnection connection;
    private readonly StubDirectory directory = new();

    public ConnectedUsersRenderTests()
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
        Services.AddSingleton(orgState);
        Services.AddSingleton<IConnectedUserDirectory>(directory);
        Services.AddSingleton<IUserService>(
            new UserService(factory, new SongPartLabelService(factory)));
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    [Fact]
    public void WithNobodyConnected_ShowsTheEmptyState()
    {
        var page = RenderComponent<ConnectedUsers>();

        page.Markup.ShouldContain("Ingen har appen öppen just nu");
    }

    [Fact]
    public void WithSomebodyConnected_ShowsThemUnderTheirOrganizationsName()
    {
        directory.Users = [Connected("Anna Svensson", tabs: 1, isConnected: true)];

        var page = RenderComponent<ConnectedUsers>();

        page.Markup.ShouldContain("Anna Svensson");
        page.Markup.ShouldContain("Betelkyrkan");
    }

    /// <summary>The tab count is only worth saying when there is more than one.</summary>
    [Fact]
    public void WithSeveralTabs_SaysHowMany()
    {
        directory.Users = [Connected("Anna Svensson", tabs: 3, isConnected: true)];

        var page = RenderComponent<ConnectedUsers>();

        page.Markup.ShouldContain("3 flikar");
    }

    [Fact]
    public void WithOneTab_DoesNotCountIt()
    {
        directory.Users = [Connected("Anna Svensson", tabs: 1, isConnected: true)];

        var page = RenderComponent<ConnectedUsers>();

        page.Markup.ShouldNotContain("flikar");
    }

    /// <summary>
    /// A closed lid is said, not hidden. The row stays while the server still holds the circuit,
    /// and without the label it would read as somebody sitting there working.
    /// </summary>
    [Fact]
    public void WhenTheirConnectionIsDown_SaysSoRatherThanDroppingTheRow()
    {
        directory.Users = [Connected("Anna Svensson", tabs: 1, isConnected: false)];

        var page = RenderComponent<ConnectedUsers>();

        page.Markup.ShouldContain("Anna Svensson");
        page.Markup.ShouldContain("Tappat kontakten");
    }

    /// <summary>Somebody arriving turns up without the page being reloaded.</summary>
    [Fact]
    public void WhenSomebodyArrives_TheListFollows()
    {
        var page = RenderComponent<ConnectedUsers>();
        page.Markup.ShouldContain("Ingen har appen öppen just nu");

        directory.Announce([Connected("Anna Svensson", tabs: 1, isConnected: true)]);

        page.WaitForAssertion(() => page.Markup.ShouldContain("Anna Svensson"));
    }

    private static ConnectedUser Connected(string name, int tabs, bool isConnected) =>
        new("user-2", name, OrganizationId, "Admin", tabs, DateTimeOffset.UtcNow, isConnected);

    public new void Dispose()
    {
        connection.Dispose();
        base.Dispose();
    }

    private sealed class StubDirectory : IConnectedUserDirectory
    {
        public IReadOnlyList<ConnectedUser> Users { get; set; } = [];

        public event Action? Changed;

        public IReadOnlyList<ConnectedUser> All() => Users;

        public void Announce(IReadOnlyList<ConnectedUser> users)
        {
            Users = users;
            Changed?.Invoke();
        }
    }

    private sealed class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
