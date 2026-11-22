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
    /// The sessions as the server last told them (`LiveSessionInfo`, JSON's values), the outputs with a page open, and
    /// the temporary screens paired with the organisation (`LiveScreen`).
    public private(set) var sessions: [Any] = []
    public private(set) var online: [String] = []
    public private(set) var screens: [Any] = []
    public private(set) var connected = false
    /// The outputs this session sends to, and those taken from another presentation until the server says so.
    public private(set) var chosen: [String] = []
    public private(set) var takeOver: [String] = []
    /// The session driven from here, while one is, and those elsewhere a member may drive (Ta kontroll, LIVE-A27).
    public private(set) var controlling: String?
    public private(set) var controllable: [[String: Any]] = []
    /// This device's session, for as long as the app runs.
    public let sessionId = UUID().uuidString.lowercased()
    /// "Tillåt fjärrstyrning" (LIVE-R39).
    public var remote = false { didSet { if remote != oldValue { step(["type": "remote", "on": remote]) } } }
    /// A controller's command taken: the app applies it to its own live state as its own change (`liveChangeView`).
    @ObservationIgnored public var onApply: (([String: Any]) -> Void)?
    /// What the session driven from here shows now (the live state as a page reads it), and that it is gone.
    @ObservationIgnored public var onMirror: (([String: Any]) -> Void)?
    @ObservationIgnored public var onLost: (() -> Void)?
    /// The owner did not confirm a command within 2 s: said once (spec 04 §2).
    @ObservationIgnored public var onUnconfirmed: (() -> Void)?

    @ObservationIgnored private let client: SyncClient
    @ObservationIgnored private var state: Any = NSNull()
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var timers: [String: Task<Void, Never>] = [:]

    public init(client: SyncClient, deviceName: String) {
        self.client = client
        let first = client.view("liveStepView", ["init": ["sessionId": sessionId, "deviceName": deviceName]], as: AnyJSON.self)?.value
        state = (first as? [String: Any])?["state"] ?? NSNull()
    }

    /// Listens while signed in; connected again after a drop, until `stop`.
    public func start() { step(["type": "start"]) }
    public func stop() {
        step(["type": "stop"])
        timers.values.forEach { $0.cancel() }
        timers = [:]
    }

    /// The app's live state changed (JSON's values; nil when nothing is presented): reported; a session that ends, ended.
    public func follow(_ pointer: [String: Any]?) { step(["type": "follow", "pointer": pointer ?? NSNull()]) }
    /// An output switched; taking one from another presentation (asked first) with `take`.
    public func setOutput(_ id: String, on: Bool, take: Bool = false) { step(["type": "output", "id": id, "on": on, "take": take]) }
    /// The data changed: what the outputs show is reported again.
    public func changed() { step(["type": "changed"]) }
    /// Ta kontroll: the session elsewhere driven from here; `release` lets go of it.
    public func control(_ id: String) { step(["type": "control", "sessionId": id]) }
    public func release() { step(["type": "release"]) }
    /// A change of the page sent to the session driven from here, shown at once.
    public func set(_ change: [String: Any]) { step(["type": "set", "change": change]) }

    /// Gives the core an event with the state it last gave, and does what it answers, in order.
    private func step(_ event: [String: Any]) {
        var e = event
        e["now"] = Int(Date().timeIntervalSince1970 * 1000)
        guard let out = client.view("liveStepView", ["state": state, "event": e], as: AnyJSON.self)?.value as? [String: Any],
              let next = out["state"] as? [String: Any] else { return }
        state = next
        sessions = next["sessions"] as? [Any] ?? []
        online = next["online"] as? [String] ?? []
        screens = next["screens"] as? [Any] ?? []
        connected = next["connected"] as? Bool ?? false
        chosen = next["chosen"] as? [String] ?? []
        takeOver = next["takeOver"] as? [String] ?? []
        controlling = (next["control"] as? [String: Any])?["sessionId"] as? String
        controllable = next["controllable"] as? [[String: Any]] ?? []
        for effect in out["effects"] as? [[String: Any]] ?? [] { perform(effect) }
    }

    private func perform(_ effect: [String: Any]) {
        switch effect["type"] as? String {
        case "openSocket": open()
        case "closeSocket":
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
            step(["type": "socketClosed"])
        case "send":
            guard let socket, let m = effect["message"], let data = try? JSONSerialization.data(withJSONObject: m) else { return }
            Task { try? await socket.send(.string(String(decoding: data, as: UTF8.self))) }
        case "timer":
            guard let name = effect["name"] as? String, let ms = (effect["ms"] as? NSNumber)?.intValue else { return }
            timers[name]?.cancel()
            timers[name] = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(ms))
                guard !Task.isCancelled, let self else { return }
                timers[name] = nil
                step(["type": "timer", "name": name])
            }
        case "apply": if let change = effect["change"] as? [String: Any] { onApply?(change) }
        case "mirror": if let pointer = effect["pointer"] as? [String: Any] { onMirror?(pointer) }
        case "lost": onLost?()
        case "unconfirmed": onUnconfirmed?()
        default: break // audio and video commands: the Mac app plays its media where it presents (not relayed yet)
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
                step(["type": "socketOpened"])
                while true {
                    let message = try await ws.receive()
                    guard socket === ws else { return }
                    guard case let .string(text) = message, let m = try? JSONSerialization.jsonObject(with: Data(text.utf8)) else { continue }
                    step(["type": "message", "message": m])
                }
            } catch {
                guard let self, socket === ws else { return }
                socket = nil
                step(["type": "socketClosed"])
            }
        }
    }
}

/// Any JSON a view answers, as JSONSerialization's values.
public struct AnyJSON: Decodable {
    public let value: Any
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull() }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let n = try? c.decode(Double.self) { value = n == n.rounded() && abs(n) < 1e15 ? Int(n) as Any : n }
        else if let s = try? c.decode(String.self) { value = s }
        else if let a = try? c.decode([AnyJSON].self) { value = a.map(\.value) }
        else { value = try c.decode([String: AnyJSON].self).mapValues(\.value) }
    }
}
