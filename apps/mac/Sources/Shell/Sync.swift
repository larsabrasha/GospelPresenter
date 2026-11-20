// A device's view of one organisation, as the web's SyncClient (packages/sync/src/client/client.ts): a local SQLite
// with the synced tables, the queue of changes not yet confirmed, and their rebase on the server's. The queue, the
// rebase, the requests, the reading of the server's answers and when to sync are the Rust core's (`syncOpen`,
// `syncMutate`, `syncRebase` and the driver `syncStepView`); this is the shell that does what it says: the network,
// the poke socket and the timers.
import Foundation

/// A change the server refused, reported once (`MutationResult`).
public struct Rejection: Decodable, Hashable, Sendable { public let id: Int, error: String }

/// Why syncing stopped until the person acts: the app needs updating, or the server no longer takes the credentials.
public enum Stopped: Equatable, Sendable { case updateRequired, signedOut(String) }

@MainActor
public final class SyncClient {
    public let core: Core
    public let session: Session
    let server: Server

    public private(set) var clientId = ""
    public private(set) var rejected: [Rejection] = []
    /// After every local change and every pull that changed rows, with the tables it wrote.
    public var onChange: ((Set<String>) -> Void)?
    /// When `connected`, `busy`, `stopped` or the queue changes.
    public var onStatus: (() -> Void)?
    /// After the sync on a connection and on each poll: fetch what a failed download left out.
    public var onMedia: (() -> Void)?

    /// The core's sync driver's state (crates/gp-core/src/sync_driver.rs), given back with each event.
    private var state: [String: Any] = [:]
    /// The pages of the pull under way, as the server sent them, until the rebase.
    private var pages: [String] = []
    private var socket: URLSessionWebSocketTask?
    private var timers: [String: Task<Void, Never>] = [:]

    /// This device's user as the core checks a change locally; the server checks again with its own.
    var caller: Caller { Caller(userId: session.me.userId, role: session.me.role, now: nil) }

    /// Opens the organisation's database at `path`: foreign keys on (SQLite ignores the PRAGMA inside a transaction),
    /// then the schema's migration and the sync tables and triggers in one transaction, as the web's `init`.
    public init(path: String, session: Session) throws {
        let db = try Database(path: path)
        try db.exec("PRAGMA journal_mode = WAL")
        try db.exec("PRAGMA foreign_keys = ON")
        core = Core(db: db)
        self.session = session
        server = try Server(session.server)
        let core = core, caller = Caller(userId: session.me.userId, role: session.me.role, now: nil)
        struct Opened: Decodable { let clientId: String }
        let opened: Opened = try core.transaction {
            _ = try core.call("migrateOrgSchema", json: "{}", caller: nil).get()
            return try Self.decode(core.call("syncOpen", ["clientId": UUID().uuidString.lowercased()], caller: caller).get())
        }
        clientId = opened.clientId
        state = Self.object(try core.call("syncStepView", ["init": [:] as [String: Any]], caller: nil).get())["state"] as? [String: Any] ?? [:]
    }

    static func decode<T: Decodable>(_ json: String?) throws -> T {
        try JSONDecoder().decode(T.self, from: Data((json ?? "null").utf8))
    }

    static func object(_ json: String?) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data((json ?? "{}").utf8))) as? [String: Any] ?? [:]
    }

    // ------------------------------------------------------------ changes and views

    /// Runs a change at once and queues it for the server, in one transaction; refused, nothing is written or queued.
    /// Then syncs, as the web's worker does after every change.
    @discardableResult
    public func mutate(_ name: String, _ args: [String: Any]) -> Refusal? {
        struct Done: Decodable { let tables: [String] }
        switch core.command("syncMutate", json: Core.json(["mutator": name, "args": Core.json(args)]), caller: caller) {
        case let .failure(r): return r
        case let .success(json):
            if let done: Done = try? Self.decode(json) { onChange?(Set(done.tables)) }
            requestSync()
            return nil
        }
    }

    /// A view of the core, read from the local database.
    public func view<T: Decodable>(_ name: String, _ args: [String: Any] = [:], as type: T.Type) -> T? {
        core.view(name, args, caller: caller, as: type)
    }

    /// How many changes wait for the server.
    public var pendingCount: Int {
        let json = (try? core.call("syncPending", json: "{}", caller: caller).get()) ?? nil
        return ((try? JSONSerialization.jsonObject(with: Data((json ?? "[]").utf8))) as? [Any])?.count ?? 0
    }

    public var stopped: Stopped? {
        switch state["stopped"] as? String {
        case "update-required": .updateRequired
        case let reason?: .signedOut(reason)
        case nil: nil
        }
    }

    public var connected: Bool { state["connected"] as? Bool ?? false }
    public var busy: Bool { state["busy"] as? Bool ?? false }

    // ------------------------------------------------------------ the core's sync driver

    /// A sync, coalesced with the one running: push, then pull every page, then the rebase.
    public func requestSync() { send(["type": "sync"]) }

    /// Keeps the poke socket open and syncs on every poke, on every (re)connection and on the backstop poll.
    public func start() { send(["type": "start"]) }

    /// Ends the socket and the timers (the app going to the background, or signing out).
    public func close() { send(["type": "close"]) }

    /// Gives the core an event with the state it last gave, and does what it answers, in order. `page` is the text of
    /// the answer the event carries, kept when the core says so.
    private func send(_ event: [String: Any], page: String? = nil) {
        let before = "\(busy) \(connected) \(String(describing: stopped))"
        let step = Self.object(try? core.call("syncStepView", ["state": state, "event": event], caller: nil).get())
        guard let next = step["state"] as? [String: Any] else { return }
        state = next
        for effect in step["effects"] as? [[String: Any]] ?? [] { perform(effect, page: page) }
        if "\(busy) \(connected) \(String(describing: stopped))" != before { onStatus?() }
    }

    private func perform(_ effect: [String: Any], page: String?) {
        switch effect["type"] as? String {
        case "beforePush":
            send(["type": "pushLimit", "limit": pendingCount]) // nothing is uploaded before a push here yet
        case "post":
            guard let path = effect["path"] as? String, let body = effect["body"] as? String else { return }
            Task { [weak self] in
                guard let self else { return }
                do {
                    let a = try await server.request("POST", path, json: body, as: session)
                    let text = String(decoding: a.body, as: UTF8.self)
                    send(["type": "answer", "status": a.status, "text": text], page: text)
                } catch {
                    send(["type": "failed", "error": "\(error)"]) // offline: the next poke or poll tries again
                }
            }
        case "keepPage":
            if let page { pages.append(page) }
        case "rebase":
            let kept = pages
            pages = []
            Task { [weak self] in self?.rebase(kept) }
        case "ended":
            pages = []
        case "media":
            onMedia?()
        case "openSocket":
            listen()
        case "closeSocket":
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
        case "timer":
            guard let name = effect["name"] as? String, let ms = (effect["ms"] as? NSNumber)?.intValue else { return }
            timers[name]?.cancel()
            timers[name] = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(ms))
                guard !Task.isCancelled, let self else { return }
                timers[name] = nil
                send(["type": "timer", "name": name])
            }
        case "cancelTimers":
            timers.values.forEach { $0.cancel() }
            timers = [:]
        default:
            break // queued, idle: what a caller waiting on a run would want
        }
    }

    /// The queue rebased onto the pages, in one transaction; the core hears it is done, or that it failed.
    private func rebase(_ pages: [String]) {
        struct Rebased: Decodable { let tables: [String], results: [Rejection], changed: Bool }
        do {
            let rebased: Rebased = try Self.decode(core.command("syncRebase", json: "{\"pages\":[\(pages.joined(separator: ","))]}", caller: caller).get())
            rejected += rebased.results
            if rebased.changed { onChange?(Set(rebased.tables)) }
            send(["type": "rebased"])
        } catch {
            send(["type": "failed", "error": "\(error)"])
        }
    }

    // ------------------------------------------------------------ media

    /// A media blob of the organisation's by its hash, written to `file`: whether the server had it.
    public func media(_ hash: String, to file: URL) async -> Bool {
        (try? await server.download("/api/media/\(hash)", as: session, to: file)) ?? false
    }

    // ------------------------------------------------------------ the poke socket

    /// One connection of the poke socket: its opening, each poke and its closing (a refused one too) told to the core.
    private func listen() {
        let ws = server.socket("/api/sync/poke", clientId: clientId, as: session)
        socket = ws
        ws.resume()
        Task { [weak self] in
            do {
                try await ws.receiveOrOpen()
                guard let self, socket === ws else { return }
                send(["type": "socketOpened"])
                while true {
                    _ = try await ws.receive()
                    guard socket === ws else { return }
                    send(["type": "poke"])
                }
            } catch {
                guard let self, socket === ws else { return }
                socket = nil
                send(["type": "socketClosed"])
            }
        }
    }
}

extension URLSessionWebSocketTask {
    /// Waits until the socket is open (a ping answered), as a browser's `open` event.
    func receiveOrOpen() async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            sendPing { error in if let error { c.resume(throwing: error) } else { c.resume() } }
        }
    }
}
