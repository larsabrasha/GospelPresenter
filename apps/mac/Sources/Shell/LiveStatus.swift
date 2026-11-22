// Who is online and who watches, for Utgångar (the web's live/remote.ts LiveLink and useLiveSessions), and the owner's
// and a controller's messages (LiveOwner.swift): the live socket
// (`/api/live/socket`, the credentials as subprotocols as the poke socket sends them) listened to while the page is open,
// its `sessions` messages kept, a ping every 20 s as the web's. What each output's line says is the core's
// (`displayStatusView`). In the shell so apps/mac's `parity settings` listens with the same code.
import Foundation
import Observation

@MainActor
@Observable
public final class LiveStatus {
    /// The sessions as the server last told them (`LiveSessionInfo`, JSON's values), and the outputs with a page open.
    public private(set) var sessions: [Any] = []
    public private(set) var online: [String] = []
    /// The temporary screens paired with the organisation (`LiveScreen`: id and its number).
    public private(set) var screens: [Any] = []
    public private(set) var connected = false
    /// Every message but `sessions` and `pong` (a command to the owner, outputs released), as JSON's values.
    @ObservationIgnored public var onMessage: (([String: Any]) -> Void)?
    /// The sessions listed anew: a controller shows what its session's owner now reports.
    @ObservationIgnored public var onSessions: (() -> Void)?
    /// The socket (re)connected: an owner reports its whole state again (LIVE-R47).
    @ObservationIgnored public var onOpen: (() -> Void)?
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var pinger: Task<Void, Never>?
    @ObservationIgnored private var session: Session?

    public init() {}

    /// Listens while `session` is signed in to a server; again a few seconds after a drop, until `stop`.
    public func start(_ session: Session?) {
        guard socket == nil, let session, let server = try? Server(session.server) else { return }
        self.session = session
        let ws = server.socket("/api/live/socket", clientId: UUID().uuidString.lowercased(), as: session)
        socket = ws
        ws.resume()
        // Opened: the first send waits for it, so the owner's report goes as soon as the socket is up.
        Task { [weak self] in
            try? await ws.send(.string(#"{"type":"ping"}"#))
            guard let self, self.socket === ws else { return }
            self.connected = true
            self.onOpen?()
        }
        pinger = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                guard let self, self.socket === ws else { return }
                try? await ws.send(.string(#"{"type":"ping"}"#))
            }
        }
        Task { [weak self] in
            do {
                while true {
                    let message = try await ws.receive()
                    guard let self, self.socket === ws else { return }
                    self.connected = true
                    guard case let .string(text) = message, let m = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { continue }
                    switch m["type"] as? String {
                    case "sessions":
                        self.sessions = m["sessions"] as? [Any] ?? []
                        self.online = m["online"] as? [String] ?? []
                        self.screens = m["screens"] as? [Any] ?? []
                        self.onSessions?()
                    case "pong": break
                    default: self.onMessage?(m)
                    }
                }
            } catch {
                guard let self, self.socket === ws else { return }
                self.connected = false
                self.socket = nil
                try? await Task.sleep(for: .seconds(3))
                if self.session != nil { self.start(self.session) }
            }
        }
    }

    /// A message to the server, JSON's values (`own`, `end`, `set`); dropped while the socket is down, as a report is
    /// sent whole again on the next connect.
    public func send(_ message: [String: Any]) {
        guard let socket, let data = try? JSONSerialization.data(withJSONObject: message), let text = String(data: data, encoding: .utf8) else { return }
        Task { try? await socket.send(.string(text)) }
    }

    public func stop() {
        session = nil
        pinger?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connected = false
    }
}
