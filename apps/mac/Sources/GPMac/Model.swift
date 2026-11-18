// What the pages show, as the Rust core answers it, and the changes the buttons send it. Where to go is the web's
// (docs/layout-2-0.md): the start page, and a presentation opened from it on a stack; presenting is in Live.swift.
import Foundation
import Observation
import Shell
import SwiftUI

/// Where the app's data is.
enum Store {
    /// The demo data, on this device alone, through the core with no sync.
    case demo(Core)
    /// An organisation's database, synced with its server.
    case synced(SyncClient)
}

@MainActor
@Observable
final class Model {
    /// Where the data is: an organisation's database synced with its server, or the demo data on this device alone.
    /// Nil until the person connects or picks the demo.
    private(set) var store: Store?
    /// The sync's state for the account menu: nil while all is well (the web says it only when there is a problem).
    var syncProblem: String?
    /// The start page's lists: Idag, Kommande, Senast ändrade.
    var groups = PresentationGroups()
    var presentations: [PresentationRow] { groups.all }
    /// The pages over the start page: the presentation opened, by its id.
    var path: [String] = [] {
        didSet { if oldValue.last != path.last { selectedItem = nil; load() } }
    }
    var selectedPresentation: String? { path.last }
    /// The presentation open, as `presentationPageView` reads it.
    var current: PresentationView?
    /// The item chosen in the running order (its row at the left, the slides scrolled to it).
    var selectedItem: String?
    var refusal: String?
    /// The role the demo's changes run with; a signed-in device has its member's.
    var role = "admin"
    /// The core's last call: its SQL statements and time, for measuring on the Mac.
    var status = ""
    /// What is presented, by this window; it goes on while another page is open (Live.swift).
    var live = Live()
    /// A one-line question open (a programme item's name, a comment), and Lägg till sång open, after which item.
    var prompt: TextPrompt?
    var addingSong: AddAt?
    /// An item whose removal asks first.
    var removing: ItemView?

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
        // For pictures and checks: `-gp.demo YES` opens the demo, `-gp.open <id>` a presentation in it, and
        // `-gp.show <itemId>/<n>` presents that slide (launch arguments, read as the app's settings).
        let args = UserDefaults.standard
        if let session = Keychain.session, !args.bool(forKey: "gp.demo") { open(session) }
        else if ProcessInfo.processInfo.environment["GP_MAC_DATA"] != nil || args.bool(forKey: "gp.demo") { openDemo() }
        if let id = args.string(forKey: "gp.open") { path = [id] }
        if let at = args.string(forKey: "gp.show")?.split(separator: "/"), at.count == 2, let n = Int(at[1]) {
            live.press(self, ["type": "start"])
            live.press(self, ["type": "show", "itemId": String(at[0]), "partIndex": n])
        }
        #if os(iOS)
        if args.bool(forKey: "gp.measure") { Task { try? await Task.sleep(for: .seconds(2)); await Measure.run(self) } }
        #endif
    }

    /// An organisation's database, synced: one file per organisation, as the web keeps one per organisation.
    func open(_ session: Session) {
        do {
            let client = try SyncClient(path: "\(Self.home)/org-\(session.me.orgId).sqlite", session: session)
            client.onChange = { [weak self] _ in self?.reload() }
            client.onStatus = { [weak self] in self?.noteSync() }
            store = .synced(client)
            Keychain.session = session
            client.start()
            reload()
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
        reload()
    }

    /// Back to the start: the session forgotten (the organisation's database stays for the next sign-in).
    func signOut() {
        if case let .synced(client) = store { client.close() }
        Keychain.session = nil
        store = nil
        path = []
        live = Live()
        groups = PresentationGroups()
    }

    var session: Session? { if case let .synced(c) = store { c.session } else { nil } }

    /// The user as the account menu names them.
    var userName: String { session?.me.name ?? "Demo" }

    private var core: Core? {
        switch store {
        case let .demo(core): core
        case let .synced(client): client.core
        case nil: nil
        }
    }

    private func note(_ what: String) {
        guard let core else { return }
        status = "\(what) · \(core.lastSqlCalls) SQL · \(Int(core.lastMicros)) µs"
    }

    /// The web's status line (`status.*`), only when there is a problem.
    private func noteSync() {
        guard case let .synced(c) = store else { syncProblem = nil; return }
        let waiting = c.pendingCount
        syncProblem = switch c.stopped {
        case .updateRequired: t("status.updateRequired")
        case .signedOut: t("status.authNeeded")
        case nil where !c.connected && !c.busy: waiting > 0 ? "\(t("status.offline")) · \(waiting == 1 ? t("status.pendingOne") : t("status.pending", ["n": waiting]))" : t("status.offline")
        case nil where waiting > 0 && !c.busy: waiting == 1 ? t("status.pendingOne") : t("status.pending", ["n": waiting])
        case nil: nil
        }
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

    /// Everything read again: after a change here, and after a pull that changed rows.
    func reload() {
        refresh()
        load()
        live.reload(self)
    }

    /// The start page, as the web's reads it: the presentations and their item counts, grouped by today's date.
    func refresh() {
        var rows = view("presentationListView", as: [PresentationRow].self) ?? []
        let counts = Dictionary((view("itemCountsView", as: [[CountCell]].self) ?? []).compactMap { pair -> (String, Int)? in
            guard pair.count == 2, case let .id(id) = pair[0], case let .n(n) = pair[1] else { return nil }
            return (id, n)
        }, uniquingKeysWith: { a, _ in a })
        for i in rows.indices { rows[i].itemCount = counts[rows[i].id] ?? 0 }
        groups = PresentationGroups(rows, today: localToday())
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

    /// The open presentation's page; before presenting, a slide made ready elsewhere is let go.
    func load() {
        current = selectedPresentation.flatMap(page)
        note("presentationPageView")
        live.opened(self)
    }

    func searchSongs(_ query: String) -> [SongHit] {
        let hits = view("searchSongsView", ["query": query], as: [SongHit].self) ?? []
        note("searchSongsView")
        return hits
    }

    /// Sends a change to the core (queued for the server when synced), then reads again what it changed.
    @discardableResult
    func run(_ name: String, _ args: [String: Any]) -> String {
        let outcome: String
        switch store {
        case let .demo(core): outcome = core.mutate(["name": name, "args": args, "ctx": ["userId": "demo", "role": role]])
        case let .synced(client): outcome = client.mutate(name, args)?.code ?? "ok"
        case nil: outcome = "not-found"
        }
        note("\(name): \(outcome)")
        if outcome != "ok" { refusal = refusalText(outcome) }
        reload()
        return outcome
    }

    func newId() -> String { UUID().uuidString.lowercased() }

    /// The open presentation is the one presented.
    var isLive: Bool { live.on && live.id == selectedPresentation }
}

/// What a refusal says to someone using the app: the web's `error.<code>` where it has one, else the code.
func refusalText(_ code: String) -> String {
    let said = t("error.\(code)")
    return said == "error.\(code)" ? code : said
}

extension PresentationRow {
    /// The row's second line, as the web's start page: "Idag", "Imorgon" or the date (with the year where asked), the
    /// time and the place, leaving out what is not set.
    func subtitle(today: String, showDate: Bool, withYear: Bool) -> String {
        let date = showDate ? eventDate : nil
        let when = [date.map { dateLabel($0, today: today, withYear: withYear) }, time].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return [when, location ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// `dateLabel` of apps/web/src/pages/dashboard.ts: "Idag", "Imorgon", or "mån 4 maj" (and the year when asked).
func dateLabel(_ iso: String, today: String, withYear: Bool) -> String {
    if iso == today { return t("presentations.today") }
    let parse = DateFormatter()
    parse.dateFormat = "yyyy-MM-dd"
    parse.locale = Locale(identifier: "en_US_POSIX")
    guard let day = parse.date(from: iso) else { return iso }
    if let next = Calendar.current.date(byAdding: .day, value: 1, to: parse.date(from: today) ?? Date()), parse.string(from: next) == iso { return t("presentations.tomorrow") }
    let show = DateFormatter()
    show.locale = Texts.locale
    show.dateFormat = withYear ? "EEE d MMMM yyyy" : "EEE d MMMM"
    return show.string(from: day).replacingOccurrences(of: ".", with: "")
}

extension Color {
    /// "#c73434", as the core gives a label's colour.
    init(hex: String) {
        self.init(hex: UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0)
    }
}
