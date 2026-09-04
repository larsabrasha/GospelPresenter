using GospelPresenter.Shared.Sync;
using Shouldly;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// The coalescing window and the device exclusion — the two things about announcements that are
/// decisions rather than plumbing. See adr/0006-organization-change-notifications.md.
/// </summary>
public class OrganizationChangeNotifierTests
{
    // Short enough to keep the suite quick, long enough that a loaded machine cannot slip a second
    // window in between two calls this test makes back to back.
    private static readonly TimeSpan Window = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task ManyChangesInOneWindow_AreOneAnnouncement()
    {
        // A push applies one save per aggregate: a first sync into an empty device was measured at
        // 871 songs and 3527 song parts. Announcing each one would be a burst of socket messages to
        // every other device in the organisation, for one answer.
        using var notifier = new OrganizationChangeNotifier(Window);
        var announcements = await Collect(notifier, expected: 1, () =>
        {
            for (var i = 0; i < 50; i++)
                notifier.Notify("org-1");
        });

        announcements.ShouldHaveSingleItem().OrganizationId.ShouldBe("org-1");
    }

    [Fact]
    public async Task TwoOrganizations_AreAnnouncedSeparately()
    {
        using var notifier = new OrganizationChangeNotifier(Window);
        var announcements = await Collect(notifier, expected: 2, () =>
        {
            notifier.Notify("org-1");
            notifier.Notify("org-2");
        });

        announcements.Select(a => a.OrganizationId).OrderBy(x => x)
            .ShouldBe(["org-1", "org-2"]);
    }

    [Fact]
    public async Task ADevicesOwnPush_IsAnnouncedWithThatDeviceExcluded()
    {
        using var notifier = new OrganizationChangeNotifier(Window);
        var announcements = await Collect(notifier, expected: 1, () =>
            notifier.Notify("org-1", "device-1"));

        announcements.ShouldHaveSingleItem().SourceDeviceId.ShouldBe("device-1");
    }

    [Fact]
    public async Task TwoWritersInOneWindow_ExcludeNobody()
    {
        // The announcement may only leave a device out if everything in it came from that device.
        // A browser edit riding along with a device's own push has to reach that device too, or it
        // would never learn about it — and the announcement it was excluded from was the only one.
        using var notifier = new OrganizationChangeNotifier(Window);
        var announcements = await Collect(notifier, expected: 1, () =>
        {
            notifier.Notify("org-1", "device-1");
            notifier.Notify("org-1");
        });

        announcements.ShouldHaveSingleItem().SourceDeviceId.ShouldBeNull();
    }

    [Fact]
    public async Task AChangeWithNoOrganization_IsAnnouncedToEverybody()
    {
        using var notifier = new OrganizationChangeNotifier(Window);
        var announcements = await Collect(notifier, expected: 1, () => notifier.Notify(null));

        announcements.ShouldHaveSingleItem().OrganizationId.ShouldBeNull();
    }

    [Fact]
    public async Task ASubscriberThatThrows_DoesNotStopTheOthers()
    {
        // On the web there is one subscriber per open circuit, plus the hub broadcaster that every
        // desktop in the organisation depends on.
        using var notifier = new OrganizationChangeNotifier(Window);
        var reached = new TaskCompletionSource();

        notifier.Announced += _ => throw new InvalidOperationException("a broken circuit");
        notifier.Announced += _ => reached.TrySetResult();

        notifier.Notify("org-1");

        await reached.Task.WaitAsync(Patience);
    }

    [Fact]
    public void ChangesAfterDisposal_AreDropped()
    {
        var notifier = new OrganizationChangeNotifier(Window);
        var announced = 0;
        notifier.Announced += _ => announced++;

        notifier.Dispose();
        notifier.Notify("org-1");

        announced.ShouldBe(0);
    }

    /// <summary>
    /// Runs <paramref name="act"/> and waits for the window to elapse, returning what was
    /// announced. Waits for a count rather than for a duration, so a slow machine cannot turn this
    /// into a flake.
    /// </summary>
    private static async Task<IReadOnlyList<OrganizationChange>> Collect(
        OrganizationChangeNotifier notifier, int expected, Action act)
    {
        var announcements = new List<OrganizationChange>();
        var enough = new TaskCompletionSource();

        notifier.Announced += change =>
        {
            lock (announcements)
            {
                announcements.Add(change);
                if (announcements.Count >= expected)
                    enough.TrySetResult();
            }
        };

        act();
        await enough.Task.WaitAsync(Patience);

        // Long enough for a second announcement to arrive if the coalescing failed to hold one
        // back, so "exactly one" means something.
        await Task.Delay(Window * 3);

        lock (announcements)
            return announcements.ToList();
    }
}
