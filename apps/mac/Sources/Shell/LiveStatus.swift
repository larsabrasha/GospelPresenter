// The device's live socket (`/api/live/socket`, the credentials as subprotocols as the poke socket sends them): who is
// online and who watches, for Utgångar; this device as its live session's owner while it presents; and a session
// elsewhere driven from here (Ta kontroll). What is reported, which command is taken, which outputs are let go, what a
// controller shows, when to ping and when to connect again are the core's (`liveStepView`, the web's LiveLink,
// owner.ts and RemoteControl); this does what it says: the socket and the timers. In the shell so apps/mac's parity
// checks drive the same code against a server.
import Foundation
import Observation

@MainActor
@Observable
public final class LiveStatus {
    /// The core's state between steps (`LiveState`, generated from the core's type); what the pages read comes from it.
    public private(set) var state: LiveState?
    /// The sessions as the server last told them (`LiveSessionInfo`, JSON's values), the outputs with a page open, and
    /// the temporary screens paired with the organisation (`LiveScreen`).
    public var sessions: [Any] { state?.sessions.map(\.plain) ?? [] }
    public var online: [String] { state?.online ?? [] }
    public var screens: [Any] { state?.screens.map(\.plain) ?? [] }
    public var connected: Bool { state?.connected ?? false }
    /// The outputs this session sends to, and those taken from another presentation until the server says so.
    public var chosen: [String] { state?.chosen ?? [] }
    public var takeOver: [String] { state?.takeOver ?? [] }
    /// The session driven from here, while one is, and those elsewhere a member may drive (Ta kontroll, LIVE-A27).
    public var controlling: String? { state?.control?.sessionId }
    public var controllable: [[String: Any]] { state?.controllable.compactMap { $0.plain as? [String: Any] } ?? [] }
    /// This device's session, for as long as the app runs.
    public let sessionId = UUID().uuidString.lowercased()
    /// "Tillåt fjärrstyrning" (LIVE-R39).
    public var remote = false { didSet { if remote != oldValue { step(.remote(on: remote)) } } }
    /// A controller's command taken: the app applies it to its own live state as its own change (`liveChangeView`).
    @ObservationIgnored public var onApply: (([String: Any]) -> Void)?
    /// What the session driven from here shows now (the live state as a page reads it), and that it is gone.
    @ObservationIgnored public var onMirror: (([String: Any]) -> Void)?
    @ObservationIgnored public var onLost: (() -> Void)?
    /// The owner did not confirm a command within 2 s: said once (spec 04 §2).
    @ObservationIgnored public var onUnconfirmed: (() -> Void)?

    @ObservationIgnored private let client: SyncClient
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var timers: [String: Task<Void, Never>] = [:]

    public init(client: SyncClient, deviceName: String) {
        self.client = client
        state = client.view("liveStepView", ["init": ["sessionId": sessionId, "deviceName": deviceName]], as: LiveStep.self)?.state
    }

    /// Listens while signed in; connected again after a drop, until `stop`.
    public func start() { step(.start) }
    public func stop() {
        step(.stop)
        timers.values.forEach { $0.cancel() }
        timers = [:]
    }

    /// The app's live state changed (JSON's values; nil when nothing is presented): reported; a session that ends, ended.
    public func follow(_ pointer: [String: Any]?) { step(.follow(pointer: JSONValue(any: pointer ?? NSNull()))) }
    /// An output switched; taking one from another presentation (asked first) with `take`.
    public func setOutput(_ id: String, on: Bool, take: Bool = false) { step(.output(id: id, on: on, take: take)) }
    /// The data changed: what the outputs show is reported again.
    public func changed() { step(.changed) }
    /// Ta kontroll: the session elsewhere driven from here; `release` lets go of it.
    public func control(_ id: String) { step(.control(sessionId: id)) }
    public func release() { step(.release) }
    /// A change of the page sent to the session driven from here, shown at once.
    public func set(_ change: [String: Any]) { step(.set(change: JSONValue(any: change))) }

    /// Gives the core an event with the state it last gave, and does what it answers, in order.
    private func step(_ event: LiveEvent) {
        guard let state, let s = JSONValue(encoding: state)?.any, let e = JSONValue(encoding: event)?.any else { return }
        let now = Int(Date().timeIntervalSince1970 * 1000)
        guard let out = client.view("liveStepView", ["state": s, "event": e, "now": now], as: LiveStep.self) else { return }
        self.state = out.state
        for effect in out.effects { perform(effect) }
    }

    private func perform(_ effect: LiveEffect) {
        switch effect {
        case .openSocket: open()
        case .closeSocket:
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
            step(.socketClosed)
        case let .send(message):
            guard let socket else { return }
            Task { try? await socket.send(.string(message.text)) }
        case let .timer(ms, name):
            timers[name]?.cancel()
            timers[name] = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(ms))
                guard !Task.isCancelled, let self else { return }
                timers[name] = nil
                step(.timer(name: name))
            }
        case let .apply(change): if let change = change.plain as? [String: Any] { onApply?(change) }
        case let .mirror(pointer): if let pointer = pointer.plain as? [String: Any] { onMirror?(pointer) }
        case .lost: onLost?()
        case .unconfirmed: onUnconfirmed?()
        // Audio and video commands: the Mac app plays its media where it presents (not relayed yet); a newer core's.
        case .audio, .video, .unknown: break
        }
    }

    /// One connection: its opening (its first send gone), each message and its closing told to the core.
    private func open() {
        let ws = client.server.socket("/api/live/socket", clientId: UUID().uuidString.lowercased(), as: client.session)
        socket = ws
        ws.resume()
        Task { [weak self] in
            do {
                // Open once the first send goes (the live socket answers a ping of its own kind, not a WebSocket ping).
                try await ws.send(.string(#"{"type":"ping"}"#))
                guard let self, socket === ws else { return }
                step(.socketOpened)
                while true {
                    let message = try await ws.receive()
                    guard socket === ws else { return }
                    guard case let .string(text) = message, let m = try? JSONSerialization.jsonObject(with: Data(text.utf8)) else { continue }
                    step(.message(message: JSONValue(any: m)))
                }
            } catch {
                guard let self, socket === ws else { return }
                socket = nil
                step(.socketClosed)
            }
        }
    }
}
