using GospelPresenter.Shared.State;
using GospelPresenter.Shared.Sync;
using GospelPresenter.Web.Sync;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Sync;

/// <summary>
/// The web's side of the announcement: which changes a circuit is allowed to hear about, and that it
/// stops hearing them when it goes away.
///
/// An ordinary unit test, living here because this is the test project that references the web host.
/// </summary>
public class CircuitRemoteChangeSignalTests
{
    [Fact]
    public void ACircuit_IsToldAboutItsOwnOrganizationsChanges()
    {
        var notifier = new RecordingNotifier();
        using var signal = new CircuitRemoteChangeSignal(notifier, OrganizationState("org-1"));
        var reloads = 0;
        signal.RemoteChangesApplied += () => reloads++;

        notifier.Announce("org-1");

        reloads.ShouldBe(1);
    }

    [Fact]
    public void ACircuit_HearsNothingAboutAnotherOrganization()
    {
        // The filter is an authorisation decision, which is why it lives here and not in the view.
        var notifier = new RecordingNotifier();
        using var signal = new CircuitRemoteChangeSignal(notifier, OrganizationState("org-1"));
        var reloads = 0;
        signal.RemoteChangesApplied += () => reloads++;

        notifier.Announce("org-2");

        reloads.ShouldBe(0);
    }

    [Fact]
    public void AChangeWithNoOrganization_ReachesEveryCircuit()
    {
        var notifier = new RecordingNotifier();
        using var signal = new CircuitRemoteChangeSignal(notifier, OrganizationState("org-1"));
        var reloads = 0;
        signal.RemoteChangesApplied += () => reloads++;

        notifier.Announce(null);

        reloads.ShouldBe(1);
    }

    [Fact]
    public void TheOrganizationIsReadWhenTheChangeArrives_NotWhenTheCircuitWasBuilt()
    {
        // A circuit exists before the user's identity is resolved, and a super admin can switch
        // organisation without the circuit being rebuilt. Reading it at construction would leave
        // such a circuit either deaf or listening to the wrong organisation.
        var notifier = new RecordingNotifier();
        var state = new ActiveOrganizationState();
        using var signal = new CircuitRemoteChangeSignal(notifier, state);
        var reloads = 0;
        signal.RemoteChangesApplied += () => reloads++;

        notifier.Announce("org-9");
        reloads.ShouldBe(0, "nothing is known about the user yet");

        state.Initialize("user-1", Shared.Models.UserRole.Admin, "org-9");
        notifier.Announce("org-9");

        reloads.ShouldBe(1);
    }

    [Fact]
    public void ADisposedCircuit_StopsListening()
    {
        // A scoped subscriber on a singleton event is a leak for as long as it stays subscribed, and
        // a circuit that ended must not go on raising events into a renderer that is gone.
        var notifier = new RecordingNotifier();
        var signal = new CircuitRemoteChangeSignal(notifier, OrganizationState("org-1"));
        var reloads = 0;
        signal.RemoteChangesApplied += () => reloads++;

        signal.Dispose();
        notifier.Announce("org-1");

        reloads.ShouldBe(0);
        notifier.Subscribers.ShouldBe(0);
    }

    private static ActiveOrganizationState OrganizationState(string organizationId)
    {
        var state = new ActiveOrganizationState();
        state.Initialize("user-1", Shared.Models.UserRole.Admin, organizationId);
        return state;
    }

    private sealed class RecordingNotifier : IOrganizationChangeNotifier
    {
        private Action<OrganizationChange>? handlers;

        public int Subscribers => handlers?.GetInvocationList().Length ?? 0;

        public void Notify(string? organizationId, string? sourceDeviceId = null) =>
            Announce(organizationId);

        public void Announce(string? organizationId) =>
            handlers?.Invoke(new OrganizationChange(organizationId, null));

        public event Action<OrganizationChange>? Announced
        {
            add => handlers += value;
            remove => handlers -= value;
        }
    }
}
