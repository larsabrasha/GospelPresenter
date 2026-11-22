// A session elsewhere, driven from here (spec 04 §2; the web's live/remote.ts RemoteControl): it shows what the owner
// last reported, except that a click shows at once until the owner's echo (the core's `remotePointerView`); a change is
// sent as the absolute command the owner takes (`remoteCommandView`); if the owner has not confirmed it within 2 s,
// `onUnconfirmed` is called once. In the shell so apps/mac's `parity live` drives the same code against a server.
import Foundation
import Observation

@MainActor
@Observable
public final class LiveController {
    public let link: LiveStatus
    public let sessionId: String
    @ObservationIgnored private let client: SyncClient
    /// The command sent last and not yet echoed.
    private var pending: [String: Any]?
    @ObservationIgnored private var warned = false
    @ObservationIgnored private var timer: Task<Void, Never>?
    /// The owner did not confirm a command within 2 s: said once (spec 04 §2).
    @ObservationIgnored public var onUnconfirmed: (() -> Void)?

    public init(link: LiveStatus, sessionId: String, client: SyncClient) {
        (self.link, self.sessionId, self.client) = (link, sessionId, client)
    }

    /// The session as the server lists it (`LiveSessionInfo`), nil once it is gone.
    public var session: [String: Any]? { link.sessions.compactMap { $0 as? [String: Any] }.first { $0["id"] as? String == sessionId } }

    private struct Shown: Decodable { let pointer: AnyJSON, confirmed: Bool }

    /// What the page shows of the session: its pointer (presentationId, itemId, partIndex, black, overlayId, rev) and
    /// whether the pending command is echoed.
    public func shown() -> (pointer: [String: Any], confirmed: Bool) {
        let s = session
        let args: [String: Any] = ["session": s.map { ["presentationId": $0["presentationId"] ?? NSNull(), "pointer": $0["pointer"] ?? NSNull()] } ?? NSNull(),
                                   "pending": pending ?? NSNull()]
        let answer = client.view("remotePointerView", args, as: Shown.self)
        let confirmed = answer?.confirmed ?? false
        if confirmed { pending = nil } // the echo settles it
        return (answer?.pointer.value as? [String: Any] ?? [:], confirmed)
    }

    /// A change of the page sent on as the command the owner takes, shown at once.
    public func set(_ change: [String: Any]) {
        struct Command: Decodable { let command: AnyJSON }
        guard let next = client.view("remoteCommandView", ["pointer": shown().pointer, "change": change], as: Command.self)?.command.value as? [String: Any] else { return }
        pending = next
        link.send(["type": "set", "sessionId": sessionId, "change": next])
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled else { return }
            if self.pending != nil, !self.shown().confirmed, !self.warned {
                self.warned = true
                self.onUnconfirmed?()
            }
            self.pending = nil
        }
    }

    /// Avsluta presentationen for a session whose owner is gone (LIVE-R50); a running owner's is its own to end.
    public func endAbandoned() { link.send(["type": "end", "sessionId": sessionId]) }
}
