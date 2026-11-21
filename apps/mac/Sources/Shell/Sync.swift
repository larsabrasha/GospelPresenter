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
        // `hooks`: this shell uploads first what a push needs (`beforePush`), as the web's client with its uploads.
        state = Self.object(try core.call("syncStepView", ["init": ["hooks": true] as [String: Any]], caller: nil).get())["state"] as? [String: Any] ?? [:]
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
            // The files and Bible texts the queued changes name go up first, as the web's MediaUploads and
            // BibleTextUploads send them; an upload that does not reach the server holds back its change and those after.
            let limit = pendingCount
            Task { [weak self] in
                guard let self else { return }
                let held = await uploadBeforePush(limit)
                send(["type": "pushLimit", "limit": held])
            }
        case "post":
            guard let path = effect["path"] as? String, let body = effect["body"] as? String else { return }
            Task { [weak self] in
                guard let self else { return }
                do {
                    let a = try await server.request("POST", path, json: body, as: session)
                    // What the driver reads of it (a refusal's error, a page's cookie and more), not the page itself,
                    // which may be megabytes and is kept here for the rebase.
                    let body = (try? JSONSerialization.jsonObject(with: a.body)) as? [String: Any] ?? [:]
                    let head = ["error", "cookie", "more"].reduce(into: [String: Any]()) { $0[$1] = body[$1] }
                    send(["type": "answer", "status": a.status, "body": head], page: String(decoding: a.body, as: UTF8.self))
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
        (try? await server.download("/api/media/\(hash)", as: session, to: file, sha256: hash)) ?? false
    }

    // ------------------------------------------------------------ uploads before a push

    /// The folder this device keeps its media files in, each named by its hash: what an import put there is uploaded
    /// from it before the change that names it is pushed.
    public var mediaDir: URL?
    /// When each blob last went up (hash → milliseconds), so one is sent once a push and not again within the grace.
    private var uploadedBlobs: [String: Int] = [:]
    /// The Bible texts that went up.
    private var uploadedTexts: Set<String> = []

    /// A file put in the media folder by an import, recorded so the core's changes may name it (`requireBlobs`) and
    /// its upload lists it (`mediaUploadsView` reads `bytes IS NOT NULL`: the bytes stay in the folder, a mark here).
    /// `held` false: a video, which went up in parts already and is only named here, as the web's addVideo records it.
    public func recordBlob(_ hash: String, contentType: String, size: Int, held: Bool = true) {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        _ = try? core.db.query("INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, \(held ? "X'00'" : "NULL"), ?) ON CONFLICT (hash) DO NOTHING",
                               [.text(value: hash), .text(value: contentType), .integer(value: Int64(size)), .integer(value: Int64(now))])
    }

    /// Uploads what the queued changes name and the server may lack, the core's lists (`mediaUploadsView`,
    /// `bibleUploadsView`): the push's limit, the place of the first change whose upload failed, else `limit`.
    private func uploadBeforePush(_ limit: Int) async -> Int {
        struct Blobs: Decodable { struct U: Decodable { let index: Int, hash: String }; let uploads: [U] }
        struct Texts: Decodable { struct U: Decodable { let index: Int, hash: String, uploaded: Bool }; let uploads: [U] }
        struct Text: Decodable { let json: String? }
        var held = limit
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let blobs = view("mediaUploadsView", ["uploaded": uploadedBlobs, "now": now], as: Blobs.self)?.uploads ?? []
        var sent = Set<String>()
        // As the web's MediaUploads and BibleTextUploads: only an unreachable server or a 5xx holds a change back; a file
        // not here is not sent (the server refuses the change), and a refused one (4xx) would be refused again.
        for u in blobs where u.index < held {
            if sent.contains(u.hash) { continue }
            guard let dir = mediaDir, let data = try? Data(contentsOf: dir.appending(path: u.hash)) else { continue }
            guard let a = try? await server.put("/api/media/\(u.hash)", data: data, as: session), a.status < 500 else { held = u.index; break }
            sent.insert(u.hash)
            if a.status < 300 { uploadedBlobs[u.hash] = now }
        }
        let texts = view("bibleUploadsView", ["uploaded": Array(uploadedTexts)], as: Texts.self)?.uploads ?? []
        for u in texts where !u.uploaded && u.index < held {
            guard let json = view("bibleTextJsonView", ["hash": u.hash], as: Text.self)?.json else { continue }
            guard let a = try? await server.put("/api/bibles/\(u.hash)", data: Data(json.utf8), contentType: "application/json", as: session),
                  a.status < 500 else { held = u.index; break }
            if a.status < 300 { uploadedTexts.insert(u.hash) }
        }
        return held
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
