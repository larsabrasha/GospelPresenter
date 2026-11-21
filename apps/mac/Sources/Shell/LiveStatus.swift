// Who is online and who watches, for Utgångar (the web's live/remote.ts LiveLink and useLiveSessions): the live socket
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
    public private(set) var connected = false
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
                    guard case let .string(text) = message, let m = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any], m["type"] as? String == "sessions" else { continue }
                    self.sessions = m["sessions"] as? [Any] ?? []
                    self.online = m["online"] as? [String] ?? []
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

    public func stop() {
        session = nil
        pinger?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connected = false
    }
}
