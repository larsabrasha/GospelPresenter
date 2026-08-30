using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.State;
using GospelPresenter.Web.Live;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Live;

/// <summary>
/// The loop protection, which is the part of the mirroring that cannot be checked by looking at it.
///
/// A phone's change has to reach the device, and the device's echo of that same change must not
/// come back down again — otherwise the two ends push each other around a circle for as long as the
/// service lasts.
/// </summary>
public class LiveCommandForwarderTests : IDisposable
{
    private const string SessionId = "d3adb33fca7e";
    private const string OrganizationId = "org-1";
    private const string ConnectionId = "conn-1";
    private const string PresentationId = "pres-1";

    private readonly SharedAppState sharedAppState = new(TimeSpan.FromHours(4));
    private readonly MirroredSessionRegistry registry = new();
    private readonly RecordingHubContext hub = new();
    private readonly LiveCommandForwarder forwarder;

    public LiveCommandForwarderTests()
    {
        forwarder = new LiveCommandForwarder(
            sharedAppState, registry, hub, NullLogger<LiveCommandForwarder>.Instance);
    }

    public void Dispose() => forwarder.Dispose();

    [Fact]
    public async Task AControllersChange_IsSentToTheDeviceThatOwnsTheSession()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        // What a phone in remote mode does: it writes the slide it worked out itself.
        SelectLocally("item-1", 1);

        var command = await hub.NextCommandAsync();
        command.ItemId.ShouldBe("item-1");
        command.PartIndex.ShouldBe(1);
    }

    [Fact]
    public async Task TheDevicesOwnEcho_IsNotSentBackToIt()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        // The device moved on by itself and reported it; the projector writes the same state in.
        registry.RecordReportedState(SessionId, State("item-1", 2));
        using (registry.SuppressForwarding(SessionId))
        {
            SelectLocally("item-1", 2);
        }

        await hub.ShouldStayQuietAsync();
    }

    [Fact]
    public async Task AHalfWrittenState_IsNotSentWhileTheOwnersReportIsBeingApplied()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        // Applying one report touches the state several times. Between the touches it matches
        // neither the old selection nor the new, and must not be mistaken for a controller's work.
        registry.RecordReportedState(SessionId, State("item-2", 0));
        using (registry.SuppressForwarding(SessionId))
        {
            sharedAppState.ActivatePresentation(SessionId, OrganizationId, PresentationId, "Sunday service");
            sharedAppState.ClearOverlay(SessionId);
            SelectLocally("item-2", 0);
        }

        await hub.ShouldStayQuietAsync();
    }

    [Fact]
    public async Task AControllerAndTheDevice_ConvergeOnWhateverTheDeviceReports()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        // The phone asks for part 5.
        SelectLocally("item-1", 5);
        var command = await hub.NextCommandAsync();
        command.PartIndex.ShouldBe(5);

        // The device only has three parts and lands on the last one. Its echo wins, and nothing
        // goes back down to argue about it.
        registry.RecordReportedState(SessionId, State("item-1", 2));
        using (registry.SuppressForwarding(SessionId))
        {
            SelectLocally("item-1", 2);
        }

        await hub.ShouldStayQuietAsync();
        sharedAppState.GetLiveSlide(SessionId).ItemPartIndex.ShouldBe(2);
    }

    [Fact]
    public async Task ASessionWhoseOwnerIsOffline_IsNotSentCommands()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);
        registry.Disconnect(ConnectionId);

        SelectLocally("item-1", 1);

        await hub.ShouldStayQuietAsync();
    }

    [Fact]
    public async Task ASessionThatIsNotMirrored_IsIgnoredEntirely()
    {
        // An ordinary browser presentation on this same server. It drives itself.
        sharedAppState.ActivatePresentation("browser1", OrganizationId, PresentationId, "Sunday service");
        sharedAppState.SetLiveSlide("browser1", SharedAppState.DefaultSlide with { ProjectItemId = "item-1" });

        await hub.ShouldStayQuietAsync();
    }

    [Fact]
    public async Task BlackingOutFromAPhone_ReachesTheDevice()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        sharedAppState.ToggleBlackScreen(SessionId);

        var command = await hub.NextCommandAsync();
        command.BlackScreen.ShouldBeTrue();
    }

    [Fact]
    public async Task ChoosingAnOverlayFromAPhone_ReachesTheDevice()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        sharedAppState.SetOverlay(SessionId, "Coffee afterwards", null, "overlay-1");

        var command = await hub.NextCommandAsync();
        command.OverlayId.ShouldBe("overlay-1");
    }

    [Fact]
    public async Task TurningRemoteControlOff_IsNotACommand()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        // Whether the session accepts remote control is the owner's decision, not an instruction
        // to be handed back to it.
        sharedAppState.DisableRemoteControl(SessionId);

        await hub.ShouldStayQuietAsync();
    }

    [Fact]
    public async Task AControllersOwnWrite_IsNotEvidenceThatTheDeviceFollowed()
    {
        // Why a controller cannot judge by what it can see. Its write goes straight into the live
        // state — that is what makes the phone feel instant, and it is the write that gets
        // forwarded — so the state already says yes while the device has done nothing at all.
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        SelectLocally("item-1", 5);
        await hub.NextCommandAsync();

        var asked = MirroredSessionStateReader.Read(sharedAppState, SessionId)!;
        var reported = registry.LastReported(SessionId)!;

        MirroredSessionStateReader.ShowsTheSame(reported, asked).ShouldBeFalse();
    }

    [Fact]
    public void OnceTheDeviceHasEchoed_TheControllerCanSeeThatItFollowed()
    {
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        SelectLocally("item-1", 5);
        registry.RecordReportedState(SessionId, State("item-1", 5));

        var asked = MirroredSessionStateReader.Read(sharedAppState, SessionId)!;
        var reported = registry.LastReported(SessionId)!;

        MirroredSessionStateReader.ShowsTheSame(reported, asked).ShouldBeTrue();
    }

    [Fact]
    public void ASessionWithNoOwner_HasNothingToCheckAgainst()
    {
        registry.LastReported("no-such-session").ShouldBeNull();
    }

    [Fact]
    public void ADeviceWithNoName_LeavesTheControllerToNumberIt()
    {
        // A token issued before device names existed. Empty is not a label, so the picker has to be
        // able to tell that apart from a name and fall back to its numbering.
        GoLive(reportedItemId: "item-1", reportedPartIndex: 0);

        registry.OwnerName(SessionId).ShouldBeNull();
    }

    // ---------- helpers ----------

    private void GoLive(string reportedItemId, int reportedPartIndex)
    {
        registry.Register(SessionId, OrganizationId, ConnectionId);
        registry.RecordReportedState(SessionId, State(reportedItemId, reportedPartIndex));

        using (registry.SuppressForwarding(SessionId))
        {
            sharedAppState.ActivatePresentation(SessionId, OrganizationId, PresentationId, "Sunday service");
            SelectLocally(reportedItemId, reportedPartIndex);
        }

        hub.Clear();
    }

    private void SelectLocally(string itemId, int partIndex) =>
        sharedAppState.SetLiveSlide(SessionId, sharedAppState.GetLiveSlide(SessionId) with
        {
            Status = LiveSlideStatus.ShowingPresentation,
            ProjectItemId = itemId,
            ItemPartIndex = partIndex
        });

    private static MirroredSessionState State(string itemId, int partIndex) =>
        new(PresentationId, "Sunday service", true, false, itemId, partIndex, null);

    /// <summary>
    /// Stands in for SignalR, collecting what would have gone down the wire. The forwarder sends on
    /// a background task on purpose — it is called from a render thread and must not block — so the
    /// assertions wait for a send rather than assuming one has already happened.
    /// </summary>
    private sealed class RecordingHubContext : IHubContext<LiveSessionHub>
    {
        private readonly RecordingClients clients = new();

        public IHubClients Clients => clients;
        public IGroupManager Groups => throw new NotSupportedException();

        public Task<MirroredSessionCommand> NextCommandAsync() => clients.NextCommandAsync();
        public Task ShouldStayQuietAsync() => clients.ShouldStayQuietAsync();
        public void Clear() => clients.Clear();
    }

    private sealed class RecordingClients : IHubClients
    {
        private readonly List<MirroredSessionCommand> sent = [];
        private readonly SemaphoreSlim arrived = new(0);
        private readonly Lock guard = new();

        public IClientProxy Client(string connectionId) => new RecordingProxy(this);

        public async Task<MirroredSessionCommand> NextCommandAsync()
        {
            (await arrived.WaitAsync(TimeSpan.FromSeconds(5))).ShouldBeTrue(
                "expected a command to be sent to the device, but none was");

            lock (guard)
            {
                return sent[^1];
            }
        }

        public async Task ShouldStayQuietAsync()
        {
            // There is nothing to wait for when the expectation is that nothing happens, so this
            // gives the background send a fair chance to have happened before saying it did not.
            (await arrived.WaitAsync(TimeSpan.FromMilliseconds(300))).ShouldBeFalse(
                "a command was sent to the device when none should have been");
        }

        public void Clear()
        {
            lock (guard)
            {
                sent.Clear();
            }

            while (arrived.CurrentCount > 0)
                arrived.Wait(0);
        }

        internal void Record(MirroredSessionCommand command)
        {
            lock (guard)
            {
                sent.Add(command);
            }

            arrived.Release();
        }

        public IClientProxy All => throw new NotSupportedException();
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => throw new NotSupportedException();
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => throw new NotSupportedException();
        public IClientProxy Group(string groupName) => throw new NotSupportedException();
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => throw new NotSupportedException();
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => throw new NotSupportedException();
        public IClientProxy User(string userId) => throw new NotSupportedException();
        public IClientProxy Users(IReadOnlyList<string> userIds) => throw new NotSupportedException();
    }

    private sealed class RecordingProxy(RecordingClients clients) : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            if (method == LiveSessionHubMethods.ApplyCommand && args is [MirroredSessionCommand command])
                clients.Record(command);

            return Task.CompletedTask;
        }
    }
}
