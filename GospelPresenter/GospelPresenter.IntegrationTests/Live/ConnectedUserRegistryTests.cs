using GospelPresenter.Web.Live;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Live;

/// <summary>
/// Who the server thinks is in the app.
///
/// There is no login to read: a signed-in user is a cookie, and a cookie says nothing about whether
/// anybody still has the page open. Circuits are what can actually be observed, so these tests are
/// about turning a bag of circuits into a list of people — one row each, however many tabs they
/// have, and still listed while their connection is down but not yet given up on.
/// </summary>
public class ConnectedUserRegistryTests
{
    private const string UserId = "user-1";

    private readonly ConnectedUserRegistry registry = new();

    [Fact]
    public void ACircuitThatSaidWhoItIs_ShowsUpAsAConnectedUser()
    {
        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");

        var user = registry.All().ShouldHaveSingleItem();
        user.UserId.ShouldBe(UserId);
        user.Name.ShouldBe("Anna Svensson");
        user.OrganizationId.ShouldBe("org-1");
        user.Tabs.ShouldBe(1);
        user.IsConnected.ShouldBeTrue();
    }

    /// <summary>
    /// One person, not one row per tab. Somebody with the operator page open on the desk and a
    /// phone in their hand is one person here, and the count is what says so.
    /// </summary>
    [Fact]
    public void TwoCircuitsForOnePerson_AreOneRowWithTwoTabs()
    {
        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");
        registry.Record("circuit-2", UserId, "Anna Svensson", "org-1", "Admin");

        registry.All().ShouldHaveSingleItem().Tabs.ShouldBe(2);
    }

    /// <summary>
    /// The identity can arrive after the connection does, so recording the same circuit twice has
    /// to fill the row in rather than count it twice.
    /// </summary>
    [Fact]
    public void TheSameCircuitRecordedTwice_IsStillOneTab()
    {
        registry.Record("circuit-1", UserId, "", "org-1", "Admin");
        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");

        var user = registry.All().ShouldHaveSingleItem();
        user.Tabs.ShouldBe(1);
        user.Name.ShouldBe("Anna Svensson");
    }

    /// <summary>
    /// A closed lid is not a sign-out. The server holds a dropped circuit for a few minutes before
    /// giving up on it, and a row that vanished and came back would say the wrong thing about both.
    /// </summary>
    [Fact]
    public void ACircuitThatDropped_IsStillListedButMarkedOutOfTouch()
    {
        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");

        registry.MarkDisconnected("circuit-1");

        registry.All().ShouldHaveSingleItem().IsConnected.ShouldBeFalse();
    }

    /// <summary>And one tab dropping says nothing while another is still up.</summary>
    [Fact]
    public void OneOfTwoTabsDropping_LeavesThePersonConnected()
    {
        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");
        registry.Record("circuit-2", UserId, "Anna Svensson", "org-1", "Admin");

        registry.MarkDisconnected("circuit-1");

        registry.All().ShouldHaveSingleItem().IsConnected.ShouldBeTrue();
    }

    [Fact]
    public void ACircuitTheServerGaveUpOn_LeavesTheList()
    {
        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");

        registry.Remove("circuit-1");

        registry.All().ShouldBeEmpty();
    }

    /// <summary>The view repaints on this rather than polling, so it has to be raised.</summary>
    [Fact]
    public void EveryChange_IsAnnounced()
    {
        var changes = 0;
        registry.Changed += () => changes++;

        registry.Record("circuit-1", UserId, "Anna Svensson", "org-1", "Admin");
        registry.MarkDisconnected("circuit-1");
        registry.Remove("circuit-1");

        changes.ShouldBe(3);
    }

    /// <summary>
    /// And nothing is announced for a circuit that was never there. A disconnect can arrive for one
    /// the registry never saw — the identity may never have been readable — and waking every open
    /// view for it would be noise.
    /// </summary>
    [Fact]
    public void AnUnknownCircuit_ChangesNothingAndAnnouncesNothing()
    {
        var changes = 0;
        registry.Changed += () => changes++;

        registry.MarkDisconnected("never-seen");
        registry.Remove("never-seen");

        changes.ShouldBe(0);
        registry.All().ShouldBeEmpty();
    }
}
