using System.Collections.Concurrent;
using GospelPresenter.Shared.Live;

namespace GospelPresenter.Web.Live;

/// <summary>
/// A live session owned by a device rather than by a browser circuit on this server.
/// </summary>
/// <param name="LastReported">
/// The last state the owner sent. Everything written into <c>SharedAppState</c> for this session is
/// compared against it: a write that matches came from the owner, and a write that does not came
/// from a controller and has to be forwarded down. Without that comparison the two would chase each
/// other — a controller's write would be forwarded, echoed back, written again, and forwarded again.
/// </param>
/// <param name="OwnerName">
/// What the user called this device when they registered it. Empty for a token issued before the
/// name existed; a controller falls back to numbering then.
/// </param>
public record MirroredSession(
    string SessionId,
    string OrganizationId,
    string ConnectionId,
    string OwnerName,
    MirroredSessionState? LastReported,
    DateTimeOffset OwnerLastSeen,
    bool OwnerConnected);

/// <summary>
/// Which live sessions on this server belong to a connected device, and how to reach them.
///
/// In memory, like <see cref="Shared.State.SharedAppState"/> itself and for the same reason: a
/// second web instance would already break the browser-to-browser remote control that exists today,
/// so nothing here makes the deployment story worse than it is. See adr/0004.
/// </summary>
public class MirroredSessionRegistry : ILiveSessionPresence
{
    private readonly ConcurrentDictionary<string, MirroredSession> sessions = new();
    private readonly ConcurrentDictionary<string, string> connectionToSession = new();
    private readonly ConcurrentDictionary<string, int> applying = new();

    /// <summary>Raised with the session id when a device registers, disconnects or reconnects.</summary>
    public event Action<string>? OwnerPresenceChanged;

    public MirroredSession Register(
        string sessionId, string organizationId, string connectionId, string ownerName = "")
    {
        // A device that reconnects replaces its own entry rather than adding one: the session id is
        // derived from the device token, so the same machine always lands on the same key.
        var session = sessions.AddOrUpdate(
            sessionId,
            _ => new MirroredSession(
                sessionId, organizationId, connectionId, ownerName, null, DateTimeOffset.UtcNow, true),
            (_, existing) =>
            {
                connectionToSession.TryRemove(existing.ConnectionId, out string? _);
                return existing with
                {
                    OrganizationId = organizationId,
                    ConnectionId = connectionId,
                    OwnerName = ownerName,
                    OwnerLastSeen = DateTimeOffset.UtcNow,
                    OwnerConnected = true
                };
            });

        connectionToSession[connectionId] = sessionId;
        OwnerPresenceChanged?.Invoke(sessionId);
        return session;
    }

    /// <summary>
    /// Marks the owner gone without removing the session. What it was showing stays in
    /// <c>SharedAppState</c> deliberately: a public output freezes on the slide it has rather than
    /// dropping to the waiting screen, so a few seconds of bad wifi are invisible to a congregation.
    /// The session is only really over when the owner says so, or when it goes stale.
    /// </summary>
    public string? Disconnect(string connectionId)
    {
        if (!connectionToSession.TryRemove(connectionId, out var sessionId))
            return null;

        // Only if this is still the current connection: a reconnection that raced the old
        // connection's teardown has already replaced it, and must not be marked offline.
        var wentOffline = false;
        sessions.AddOrUpdate(
            sessionId,
            _ => throw new InvalidOperationException("Disconnecting a session that is not registered."),
            (_, existing) =>
            {
                if (existing.ConnectionId != connectionId) return existing;
                wentOffline = true;
                return existing with { OwnerConnected = false };
            });

        if (!wentOffline) return null;

        OwnerPresenceChanged?.Invoke(sessionId);
        return sessionId;
    }

    public void Remove(string sessionId)
    {
        if (!sessions.TryRemove(sessionId, out var session)) return;
        connectionToSession.TryRemove(session.ConnectionId, out _);
        applying.TryRemove(sessionId, out _);
        OwnerPresenceChanged?.Invoke(sessionId);
    }

    /// <summary>
    /// Records what the owner says it is showing. Called before the state is written into
    /// <c>SharedAppState</c>, so that the write is already recognisable as the owner's own.
    /// </summary>
    public void RecordReportedState(string sessionId, MirroredSessionState state)
    {
        sessions.AddOrUpdate(
            sessionId,
            _ => throw new InvalidOperationException("Reporting state for a session that is not registered."),
            (_, existing) => existing with { LastReported = state, OwnerLastSeen = DateTimeOffset.UtcNow });
    }

    /// <summary>
    /// Holds off command forwarding while a report from the owner is being written in.
    ///
    /// Writing one report touches the live state several times — the active presentation, the
    /// overlay, the slide — and each touch raises a change of its own. Between the first and the
    /// last, the state is a mixture of the old selection and the new one, and matches neither. A
    /// forwarder watching those intermediate states would send the owner a command to go back to
    /// where it just was.
    /// </summary>
    public IDisposable SuppressForwarding(string sessionId)
    {
        applying.AddOrUpdate(sessionId, 1, (_, depth) => depth + 1);
        return new ForwardingSuppression(this, sessionId);
    }

    public bool IsForwardingSuppressed(string sessionId) => applying.ContainsKey(sessionId);

    private void ReleaseForwarding(string sessionId)
    {
        // AddOrUpdate cannot remove, so the last release takes the key out explicitly.
        var remaining = applying.AddOrUpdate(sessionId, 0, (_, depth) => depth - 1);
        if (remaining <= 0)
            applying.TryRemove(sessionId, out _);
    }

    private sealed class ForwardingSuppression(MirroredSessionRegistry registry, string sessionId) : IDisposable
    {
        private bool released;

        public void Dispose()
        {
            if (released) return;
            released = true;
            registry.ReleaseForwarding(sessionId);
        }
    }

    public MirroredSession? Find(string sessionId) => sessions.GetValueOrDefault(sessionId);

    public string? SessionFor(string connectionId) => connectionToSession.GetValueOrDefault(connectionId);

    public bool IsMirrored(string sessionId) => sessions.ContainsKey(sessionId);

    /// <summary>
    /// Whether a mirrored session's owner is reachable right now. Controllers ask this to decide
    /// whether their buttons will do anything — a frozen session still renders, but cannot be driven.
    /// A session that is not mirrored is always reachable: it is running on this server.
    /// </summary>
    public bool IsOwnerOnline(string sessionId) =>
        !sessions.TryGetValue(sessionId, out var session) || session.OwnerConnected;

    /// <summary>
    /// A read of what the forwarder already keeps. Nothing here writes: the entry is still recorded
    /// only by <see cref="RecordReportedState"/> on the owner's own report, so the loop protection
    /// sees exactly what it saw before.
    /// </summary>
    public MirroredSessionState? LastReported(string sessionId) =>
        sessions.GetValueOrDefault(sessionId)?.LastReported;

    public string? OwnerName(string sessionId) =>
        sessions.GetValueOrDefault(sessionId)?.OwnerName is { Length: > 0 } name ? name : null;

    public IReadOnlyList<MirroredSession> All() => sessions.Values.ToList();
}
