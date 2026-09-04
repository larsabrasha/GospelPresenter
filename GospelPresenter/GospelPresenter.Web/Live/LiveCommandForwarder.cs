using System.ComponentModel;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.State;
using Microsoft.AspNetCore.SignalR;

namespace GospelPresenter.Web.Live;

/// <summary>
/// Carries a controller's changes down to the device that owns the session.
///
/// A phone in remote mode writes into the live state exactly as it does when it is driving a
/// browser — it has the presentation loaded and works out the slide itself, so its own screen
/// updates immediately and nothing waits on a round trip. For a mirrored session that write is not
/// the last word, though: the device is the one with the projector. This watches for such writes
/// and asks the device to go there, and the device's echo is what settles the matter.
///
/// Commands are absolute — go to this item, this part — so a duplicate, a reordering or a resend
/// after reconnecting all land in the same place.
/// </summary>
public class LiveCommandForwarder : IDisposable
{
    private readonly SharedAppState sharedAppState;
    private readonly MirroredSessionRegistry registry;
    private readonly IHubContext<LiveSessionHub> hub;
    private readonly ILogger<LiveCommandForwarder> logger;

    public LiveCommandForwarder(
        SharedAppState sharedAppState,
        MirroredSessionRegistry registry,
        IHubContext<LiveSessionHub> hub,
        ILogger<LiveCommandForwarder> logger)
    {
        this.sharedAppState = sharedAppState;
        this.registry = registry;
        this.hub = hub;
        this.logger = logger;

        sharedAppState.SessionChanged += OnSessionChanged;
    }

    private void OnSessionChanged(SessionChange change)
    {
        // No filter on Kind: the report sent to the owner carries the whole state, so every kind
        // of change can make it differ from what the owner last said.
        var sessionId = change.SessionId;
        var session = registry.Find(sessionId);
        if (session is null) return;

        // Mid-write: the state is a mixture of the old selection and the new one and means nothing
        // yet. The owner's report is what put it there, so there is nothing to send back either.
        if (registry.IsForwardingSuppressed(sessionId)) return;

        if (!session.OwnerConnected) return;

        var current = MirroredSessionStateReader.Read(sharedAppState, sessionId);
        if (current is null) return;

        // The owner already knows: this is its own state coming back around.
        if (session.LastReported is { } reported && MirroredSessionStateReader.ShowsTheSame(current, reported))
            return;

        Send(session, current.ToCommand());
    }

    private void Send(MirroredSession session, MirroredSessionCommand command)
    {
        // Fire and forget: the caller is a synchronous state change on somebody's render thread,
        // and must not wait on a socket. A command that fails to send is not retried — the state it
        // described is already stale by the time a retry would land.
        _ = Task.Run(async () =>
        {
            try
            {
                await hub.Clients.Client(session.ConnectionId)
                    .SendAsync(LiveSessionHubMethods.ApplyCommand, command);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Could not send a command to the device owning session {SessionId}", session.SessionId);
            }
        });
    }

    public void Dispose()
    {
        sharedAppState.SessionChanged -= OnSessionChanged;
        GC.SuppressFinalize(this);
    }
}
