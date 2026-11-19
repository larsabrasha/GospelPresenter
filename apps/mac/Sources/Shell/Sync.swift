// A device's view of one organisation, as the web's SyncClient (packages/sync/src/client/client.ts): a local SQLite
// with the synced tables, the queue of changes not yet confirmed, and their rebase on the server's. The queue, the
// rebase and the triggers are the Rust core's (`syncOpen`, `syncMutate`, `syncPending`, `syncRebase`, each in one
// transaction); this is the shell around them: the network, the poke socket, when to sync and the server's refusals.
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
    /// The protocol of packages/core/src/protocol.ts that this shell speaks.
    static let protocolVersion = 1
    /// How long after a closed or refused poke socket the next try waits, and the backstop poll (the web's worker).
    static let reconnect: Duration = .seconds(3), poll: Duration = .seconds(5 * 60)

    public private(set) var clientId = ""
    public private(set) var stopped: Stopped?
    public private(set) var connected = false
    public private(set) var busy = false
    public private(set) var rejected: [Rejection] = []
    /// After every local change and every pull that changed rows, with the tables it wrote.
    public var onChange: ((Set<String>) -> Void)?
    /// When `connected`, `busy`, `stopped` or the queue changes.
    public var onStatus: (() -> Void)?

    private var running: Task<Void, Never>?
    private var again = false
    private var socket: URLSessionWebSocketTask?
    private var loops: [Task<Void, Never>] = []

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
    }

    static func decode<T: Decodable>(_ json: String?) throws -> T {
        try JSONDecoder().decode(T.self, from: Data((json ?? "null").utf8))
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

    struct Pending: Decodable { let id: Int, name: String, v: Int, args: String }

    func pending() -> [Pending] {
        (try? Self.decode(core.call("syncPending", json: "{}", caller: caller).get())) ?? []
    }

    /// How many changes wait for the server.
    public var pendingCount: Int { pending().count }

    // ------------------------------------------------------------ push and pull

    private var schemaVersion: Int64 {
        if case let .integer(v)? = (try? core.db.query("SELECT version FROM _schema WHERE one = 1"))?.first?.first { return v }
        return 0
    }

    /// The JSON text of a request's common fields, before its own.
    private func head() -> String {
        "\"protocol\":\(Self.protocolVersion),\"schemaVersion\":\(schemaVersion),\"clientId\":\(Core.json(clientId))"
    }

    /// Sends the queue. A network failure leaves it as it is; the server confirms through the next pull.
    func push() async throws {
        guard stopped == nil else { return }
        let queue = pending()
        guard !queue.isEmpty else { return }
        // Each change's arguments as the core queued them, their JSON text unchanged.
        let changes = queue.map { "{\"id\":\($0.id),\"name\":\(Core.json($0.name)),\"v\":\($0.v),\"args\":\($0.args)}" }
        let a = try await server.request("POST", "/api/sync/push", json: "{\(head()),\"mutations\":[\(changes.joined(separator: ","))]}", as: session)
        if refused(a) { return }
        guard a.status == 200 else { throw URLError(.badServerResponse) }
    }

    /// Fetches every page of changes, then rebases the queue onto them in one transaction.
    func pull() async throws {
        guard stopped == nil else { return }
        let meta = try core.db.query("SELECT cookie, last_mutation_id FROM _sync_meta")
        var cookie: String? = if case let .text(c)? = meta.first?.first { c } else { nil }
        let last: Int64 = if case let .integer(n)? = meta.first?.last { n } else { 0 }
        var pages: [String] = []
        struct Page: Decodable { let cookie: String, more: Bool }
        while true {
            let body = "{\(head()),\"cookie\":\(Core.json(cookie ?? NSNull())),\"lastMutationId\":\(last)}"
            let a = try await server.request("POST", "/api/sync/pull", json: body, as: session)
            if refused(a) { return }
            guard a.status == 200, let page = try? JSONDecoder().decode(Page.self, from: a.body) else { throw URLError(.badServerResponse) }
            pages.append(String(decoding: a.body, as: UTF8.self))
            cookie = page.cookie
            if !page.more { break }
        }
        struct Rebased: Decodable { let tables: [String], results: [Rejection], changed: Bool }
        let rebased: Rebased = try Self.decode(core.command("syncRebase", json: "{\"pages\":[\(pages.joined(separator: ","))]}", caller: caller).get())
        rejected += rebased.results
        if rebased.changed { onChange?(Set(rebased.tables)) }
    }

    /// An answer that stops syncing: "update required", or credentials the server no longer takes (SYNC-A15).
    private func refused(_ a: Answer) -> Bool {
        let error = a.error
        if a.status == 426 && error == "update-required" { stop(.updateRequired); return true }
        if (a.status == 401 || a.status == 403), let error, ["unauthenticated", "not-a-member", "device-not-paired"].contains(error) {
            stop(.signedOut(error))
            return true
        }
        return false
    }

    private func stop(_ why: Stopped) {
        stopped = why
        socket?.cancel(with: .goingAway, reason: nil)
        onStatus?()
    }

    /// Push, then pull. Runs are coalesced: at most one running and one waiting.
    @discardableResult
    public func requestSync() -> Task<Void, Never> {
        if let running { again = true; return running }
        let run = Task { [weak self] in
            guard let self else { return }
            repeat {
                again = false
                do { try await push(); try await pull() } catch {} // offline: the next poke or poll tries again
            } while again
            running = nil
            busy = false
            onStatus?()
        }
        running = run
        busy = true
        onStatus?()
        return run
    }

    // ------------------------------------------------------------ media

    /// A media blob of the organisation's by its hash, written to `file`: whether the server had it.
    public func media(_ hash: String, to file: URL) async -> Bool {
        (try? await server.download("/api/media/\(hash)", as: session, to: file)) ?? false
    }

    // ------------------------------------------------------------ the poke socket

    /// Keeps the poke socket open and syncs on every poke, on every (re)connection and on the backstop poll; stops
    /// for good once the server refuses the credentials.
    public func start() {
        guard loops.isEmpty else { return }
        loops.append(Task { [weak self] in
            while let self, !Task.isCancelled, stopped == nil {
                await listen()
                try? await Task.sleep(for: Self.reconnect)
            }
        })
        loops.append(Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.poll)
                await self?.requestSync().value
            }
        })
    }

    /// Ends the socket and the loops (the app going to the background, or signing out).
    public func close() {
        loops.forEach { $0.cancel() }
        loops = []
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connected = false
    }

    /// One connection of the poke socket, until it closes.
    private func listen() async {
        let ws = server.socket("/api/sync/poke", clientId: clientId, as: session)
        socket = ws
        ws.resume()
        do {
            _ = try await ws.receiveOrOpen()
            connected = true
            onStatus?()
            await requestSync().value // catch up on what happened while disconnected
            while true {
                _ = try await ws.receive()
                requestSync()
            }
        } catch {
            // A refused socket says nothing of why: a sync tells offline from refused credentials.
            let was = connected
            connected = false
            onStatus?()
            if !was { await requestSync().value }
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
