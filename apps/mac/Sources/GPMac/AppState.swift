// What the app holds once, for all its windows (docs/view-models.md, "State in three places"): where the data is and
// its sync, the start page's lists, and the app's live state (Live.swift), the presentation presented, the same in
// every window. Each window has its own Model (Model.swift): its way through the pages and its page's own state, so
// two iPad windows each select and make ready on their own. A change made anywhere is read again in every window.
import Foundation
import Observation
import Shell

/// Where the app's data is.
enum Store {
    /// The demo data, on this device alone, through the core with no sync.
    case demo(Core)
    /// An organisation's database, synced with its server.
    case synced(SyncClient)
}

@MainActor
@Observable
final class AppState {
    /// Where the data is: an organisation's database synced with its server, or the demo data on this device alone.
    /// Nil until the person connects or picks the demo.
    private(set) var store: Store?
    /// The sync's state for the account menu: nil while all is well (the web says it only when there is a problem).
    var syncProblem: String?
    /// The start page's lists, as the core groups them (`startPageView`).
    var lists: [StartList] = []
    /// The role the demo's changes run with; a signed-in device has its member's.
    var role = "admin"
    /// The core's last call: its SQL statements and time, for measuring on the Mac.
    var status = ""
    /// What is presented, the same for every window; it goes on while another page is open (Live.swift).
    private(set) var live = Live()
    /// The audio and video of what is presented, played on this device (LivePlayer.swift).
    let player = LivePlayer()
    /// Raised when media files arrived (MediaSync.swift): a picture drawn without its file is drawn again.
    var mediaGeneration = 0
    @ObservationIgnored var mediaRunning = false
    @ObservationIgnored var mediaAgain = false
    /// The sync's grace (the core's `syncStatusView`): whether changes waiting or no connection have held long enough to
    /// count as a problem, and the timer that says so.
    @ObservationIgnored private var waitedLong = false
    @ObservationIgnored private var grace: Task<Void, Never>?
    /// What a connection or the demo refused, said where it was asked for.
    var refusal: String?
    /// The windows open, each read again after a change.
    @ObservationIgnored private var windows: [Weak] = []
    /// The launch arguments' presentation, slide presented and slide made ready, taken by the first window.
    @ObservationIgnored private(set) var launch: (open: String?, show: String?, pick: String?)
    /// GP_MAC_COMPARE or `-gp.compare`: the painter's pictures for the check against SlideView (Compare.swift).
    @ObservationIgnored private var compare: String?
    /// `-gp.secondWindow YES`: the first window opens a second once, for the UI test of two windows (WindowsTests).
    @ObservationIgnored private var secondWindow = UserDefaults.standard.bool(forKey: "gp.secondWindow")
    private struct Weak { weak var model: Model? }

    /// The app's own folder: the organisations' databases and the demo's (GP_MAC_DATA on the Mac, for build.sh run).
    static let home: String = {
        let files = FileManager.default
        #if os(iOS)
        let home = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].path
        #else
        let home = files.currentDirectoryPath
        #endif
        let dir = ProcessInfo.processInfo.environment["GP_MAC_DATA"] ?? home
        try? files.createDirectory(atPath: dir, withIntermediateDirectories: true)
        return dir
    }()

    init() {
        // For pictures and checks: `-gp.demo YES` opens the demo (`-gp.fixture <path>` a scenario's data instead),
        // `-gp.open <id>` a presentation in the first window, and `-gp.show <itemId>/<n>` presents that slide (launch
        // arguments, read as the app's settings).
        let args = UserDefaults.standard
        if let session = Keychain.session, !args.bool(forKey: "gp.demo") { open(session) }
        else if let file = args.string(forKey: "gp.fixture") { openFixture(file) }
        else if ProcessInfo.processInfo.environment["GP_MAC_DATA"] != nil || args.bool(forKey: "gp.demo") { openDemo() }
        launch = (args.string(forKey: "gp.open"), args.string(forKey: "gp.show"), args.string(forKey: "gp.pick"))
        compare = ProcessInfo.processInfo.environment["GP_MAC_COMPARE"] ?? args.string(forKey: "gp.compare")
    }

    /// A window opened: read again after every change; the first takes the launch arguments.
    func add(_ window: Model) {
        windows = windows.filter { $0.model != nil } + [Weak(model: window)]
        if let out = compare {
            compare = nil
            Task { try? await Task.sleep(for: .seconds(1.5)); await Compare.run(window, out: out) }
        }
        #if os(macOS)
        if let out = ProcessInfo.processInfo.environment["GP_MAC_PLAYTEST"], windows.count == 1 {
            Task { try? await Task.sleep(for: .seconds(1.5)); await PlayTest.run(window, out: out) }
        }
        #endif
        if launch.open != nil || launch.show != nil || launch.pick != nil {
            let (open, show, pick) = launch
            launch = (nil, nil, nil)
            window.launched(open: open, show: show, pick: pick)
        }
    }

    /// The other window that has this presentation open, if one has: a presentation has one window (Model.path).
    func window(showing id: String, except me: Model) -> Model? {
        windows.compactMap(\.model).first { $0 !== me && $0.selectedPresentation == id }
    }

    /// Whether a window should open a second one now: once, with `-gp.secondWindow YES`.
    func takeSecondWindow() -> Bool {
        defer { secondWindow = false }
        return secondWindow
    }

    /// An organisation's database, synced: one file per organisation, as the web keeps one per organisation.
    func open(_ session: Session) {
        do {
            let client = try SyncClient(path: "\(Self.home)/org-\(session.me.orgId).sqlite", session: session)
            client.onChange = { [weak self] _ in self?.changed() }
            client.onStatus = { [weak self] in self?.noteSync() }
            client.onMedia = { [weak self] in self?.syncMedia() }
            store = .synced(client)
            Keychain.session = session
            client.start()
            changed()
            noteSync()
        } catch {
            refusal = "\(error)"
        }
    }

    /// The demo data on this device alone: app.sqlite, copied from demo.sqlite (GP_MAC_DATA's, or the app's own).
    func openDemo() {
        let files = FileManager.default
        let path = "\(Self.home)/app.sqlite", demo = "\(Self.home)/demo.sqlite"
        if !files.fileExists(atPath: path) { try? files.copyItem(atPath: files.fileExists(atPath: demo) ? demo : Bundle.main.path(forResource: "demo", ofType: "sqlite")!, toPath: path) }
        guard let db = try? Database(path: path) else { return }
        try? db.exec("PRAGMA journal_mode = WAL")
        let core = Core(db: db)
        // The demo data as today's schema has it (it may be made by an older core).
        _ = core.command("migrateOrgSchema", json: "{}", caller: nil)
        store = .demo(core)
        changed()
    }

    /// A scenario's organisation (`-gp.fixture <path>` to packages/rust-core/scenarios/<name>.json), made afresh by its
    /// mutations, for the UI tests that check what the app draws against the core's answers (apps/mac/ios/UITests).
    func openFixture(_ file: String) {
        let path = "\(Self.home)/fixture.sqlite"
        for end in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + end) }
        guard let data = FileManager.default.contents(atPath: file),
              let setup = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["setup"] as? [[Any]],
              let db = try? Database(path: path) else { return }
        let core = Core(db: db)
        _ = core.command("migrateOrgSchema", json: "{}", caller: nil)
        for step in setup {
            guard step.count == 2, let name = step[0] as? String else { continue }
            _ = core.mutate(["name": name, "args": step[1], "ctx": ["userId": "fixture", "role": "admin", "now": 1000]])
        }
        store = .demo(core)
        changed()
    }

    /// Back to the start: the session forgotten (the organisation's database stays for the next sign-in), every window
    /// on the start page.
    func signOut() {
        if case let .synced(client) = store { client.close() }
        Keychain.session = nil
        store = nil
        live = Live()
        lists = []
        for w in windows { w.model?.path = [] }
    }

    var session: Session? { if case let .synced(c) = store { c.session } else { nil } }

    private var core: Core? {
        switch store {
        case let .demo(core): core
        case let .synced(client): client.core
        case nil: nil
        }
    }

    func note(_ what: String) {
        guard let core else { return }
        status = "\(what) · \(core.lastSqlCalls) SQL · \(Int(core.lastMicros)) µs"
    }

    /// How the sync stands, as the core says it (`syncStatusView`), only when there is a problem: what needs the person
    /// (an update, signing in or pairing again) in the web's words for its yellow line, as this app has none; else
    /// the problem's texts, offline or changes waiting once they have held past the core's grace.
    private func noteSync() {
        guard case let .synced(c) = store else { syncProblem = nil; return }
        struct Status: Decodable {
            struct Text: Decodable { let code: String; let n: Int? }
            struct Notice: Decodable { let code: String }
            let problem: Bool, texts: [Text], notice: Notice?, waiting: Bool, graceMs: Int
        }
        let stopped: Any = switch c.stopped {
        case .updateRequired: "update-required"
        case let .signedOut(reason): reason
        case nil: NSNull()
        }
        let args: [String: Any] = ["pending": c.pendingCount, "stopped": stopped, "connected": c.connected, "busy": c.busy, "waitedLong": waitedLong]
        guard let s = c.view("syncStatusView", args, as: Status.self) else { return }
        if !s.waiting {
            grace?.cancel()
            grace = nil
            waitedLong = false
        } else if grace == nil, !waitedLong {
            grace = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(s.graceMs))
                guard !Task.isCancelled, let self else { return }
                grace = nil
                waitedLong = true
                noteSync()
            }
        }
        let texts = s.texts.map { $0.code == "pending" ? t("status.pending", ["n": $0.n ?? 0]) : t("status.\($0.code)") }
        syncProblem = s.notice.map { t("status.\($0.code)") } ?? (s.problem ? texts.joined(separator: " · ") : nil)
    }

    func syncNow() { if case let .synced(c) = store { c.requestSync() } }

    /// A view of the core, as the store's user.
    func view<T: Decodable>(_ name: String, _ args: [String: Any] = [:], as type: T.Type) -> T? {
        switch store {
        case let .demo(core): core.view(name, args, caller: Caller(userId: "demo", role: role, now: nil), as: type)
        case let .synced(client): client.view(name, args, as: type)
        case nil: nil
        }
    }

    /// A change sent to the core (queued for the server when synced), and every window read again: its outcome.
    func mutate(_ name: String, _ args: [String: Any]) -> String {
        let outcome: String
        switch store {
        case let .demo(core): outcome = core.mutate(["name": name, "args": args, "ctx": ["userId": "demo", "role": role]])
        case let .synced(client): outcome = client.mutate(name, args)?.code ?? "ok"
        case nil: outcome = "not-found"
        }
        note("\(name): \(outcome)")
        changed()
        return outcome
    }

    /// Everything read again, in every window: after a change here, and after a pull that changed rows.
    func changed() {
        lists = view("startPageView", ["today": localToday()], as: [StartList].self) ?? []
        live.reload(self)
        windows = windows.filter { $0.model != nil }
        for w in windows { w.model?.load() }
        syncMedia()
    }

    /// The live state changed: each window's page as that leaves it (presenting started or ended); another item shown
    /// moves only the selection of the window that showed it, the others keep theirs (`pageEventView`).
    func liveChanged() {
        for w in windows { w.model?.send(["type": "sync"]) }
        // Presenting fetches the presentation's files at once (wantedMediaView).
        syncMedia()
    }

    /// A presentation's page as `presentationPageView` reads it.
    func page(_ id: String) -> PresentationView? {
        guard var page = view("presentationPageView", ["id": id], as: PresentationPage.self).flatMap(PresentationView.init) else { return nil }
        // Each item's overlay, as the web's tiles read it (`useShownOverlay`): the core's `overlayView`, once an overlay.
        var overlays: [String: JSONValue?] = [:]
        for i in page.items.indices {
            guard let oid = page.items[i].overlayId else { continue }
            if overlays[oid] == nil { overlays[oid] = view("overlayView", ["id": oid], as: JSONValue.self) }
            page.items[i].overlay = overlays[oid] ?? nil
        }
        return page
    }
}
