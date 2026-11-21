// A window: what its pages show, as the Rust core answers it, and the changes its buttons send. Where to go is the
// web's (docs/layout-2-0.md): the start page, and a presentation opened from it on a stack. Each window has its own,
// over the app's one AppState (the data, the sync, the live state; AppState.swift), so two iPad windows each have their
// own page, selection and slide made ready, and see the same presentation presented.
import Foundation
import Observation
import Shell
import SwiftUI

@MainActor
@Observable
final class Model {
    /// What the app holds once, for all its windows.
    let app: AppState
    /// The pages over the start page: the presentation opened, by its id. A presentation open in another window is not
    /// opened again: that window comes forward and this one stays where it was, as Keynote has one window a document
    /// (Lars, 2026-11-18).
    var path: [String] = [] {
        didSet {
            guard oldValue.last != path.last else { return }
            if let id = path.last, let other = app.window(showing: id, except: self) {
                path = oldValue
                other.bringForward()
                return
            }
            opened()
        }
    }
    /// The system's window this Model draws in, to bring it forward (`WindowReader`).
    @ObservationIgnored weak var window: PlatformWindow?

    /// This window to the front, as the system brings one: on an iPad its scene made active, on a Mac made key.
    func bringForward() {
        #if os(iOS)
        if let scene = window?.windowScene { UIApplication.shared.requestSceneSessionActivation(scene.session, userActivity: nil, options: nil) }
        #else
        window?.makeKeyAndOrderFront(nil)
        #endif
    }
    var selectedPresentation: String? { path.last }
    /// The presentation open, as `presentationPageView` reads it.
    var current: PresentationView?
    /// The open page's own state, this window's, the core's (`send`, `pageEventView`): the item selected, the slide
    /// made ready, the last thing added.
    private(set) var pageState = PageState()
    /// The item chosen in the running order (its row at the left, the slides scrolled to it); choosing one is the
    /// page's `select` event.
    var selectedItem: String? {
        get { pageState.selectedId }
        set { if let newValue, newValue != pageState.selectedId { send(["type": "select", "itemId": newValue]) } }
    }
    /// The item added last, which the next addition follows (`addPositionView`); let go when presenting starts or ends.
    var lastAddedId: String? { pageState.lastAddedId }
    /// What this window's last change was refused for.
    var refusal: String?
    /// A one-line question open (a programme item's name, a comment), and Lägg till sång open, after which item.
    var prompt: TextPrompt?
    var addingSong: AddAt?
    /// An item whose removal asks first.
    var removing: ItemView?
    /// Inställningar open over the page (iOS; a Mac opens a window of its own).
    var settingsOpen = false

    init(app: AppState) {
        self.app = app
        app.add(self)
    }

    /// The launch arguments, for the first window: `-gp.open <id>` a presentation, `-gp.show <itemId>/<n>` that
    /// slide presented, `-gp.pick <itemId>/<n>` that slide made ready before presenting.
    func launched(open: String?, show: String?, pick: String?) {
        if let open { path = [open]; opened() }
        if let at = show?.split(separator: "/"), at.count == 2, let n = Int(at[1]) {
            send(["type": "start"])
            send(["type": "show", "itemId": String(at[0]), "partIndex": n])
        }
        if let at = pick?.split(separator: "/"), at.count == 2, let n = Int(at[1]) {
            send(["type": "show", "itemId": String(at[0]), "partIndex": n])
        }
        #if os(iOS)
        if UserDefaults.standard.bool(forKey: "gp.measure") { Task { try? await Task.sleep(for: .seconds(2)); await Measure.run(self) } }
        #endif
    }

    // The app's, as every window reads it.
    var store: Store? { app.store }
    var syncProblem: String? { app.syncProblem }
    var lists: [StartList] { app.lists }
    var presentations: [PresentationRow] { app.lists.flatMap(\.rows) }
    /// The signed-in user's role as the server says it (`me.role`, as the web reads it); the demo's picker's without one.
    var role: String {
        get { app.session?.me.role ?? app.role }
        set { app.role = newValue }
    }
    var live: Live { app.live }
    var session: Session? { app.session }
    /// The user as the account menu names them.
    var userName: String { session?.me.name ?? "Demo" }
    func open(_ session: Session) { app.open(session); refusal = app.refusal }
    func openDemo() { app.openDemo() }
    func signOut() { app.signOut() }
    func syncNow() { app.syncNow() }
    func view<T: Decodable>(_ name: String, _ args: [String: Any] = [:], as type: T.Type) -> T? { app.view(name, args, as: type) }
    func page(_ id: String) -> PresentationView? { app.page(id) }

    /// The open presentation's page, read again (AppState.changed, in every window).
    func load() {
        current = selectedPresentation.flatMap(page)
        app.note("presentationPageView")
    }

    /// Another presentation opened: its page's state starts afresh, the item shown selected if it is the one presented.
    func opened() {
        let shown = live.id == selectedPresentation ? live.state.itemId : nil
        pageState = PageState(selectedId: shown, presenting: live.on && live.id == selectedPresentation, followed: shown)
        load()
    }

    /// An event of the open page (a key, a tap, a row chosen, an addition), as the core answers it.
    @discardableResult
    func send(_ event: [String: Any]) -> PageAnswer? { step(["event": event]) }

    /// An event of the open page, or a change of the live state made outside its keys (`change`), carried through by
    /// the core in one step (`pageStepView`): the page's state, the live state with the overlays' rules, and the page
    /// as that leaves it. A change to the live state reaches every window's page; only this one's selection followed
    /// it, the others sync (`AppState.liveChanged`).
    @discardableResult
    private func step(_ what: [String: Any]) -> PageAnswer? {
        guard let open = selectedPresentation, let items = current?.items else { return nil }
        var args: [String: Any] = ["state": jsonObject(pageState), "context": ["presentationId": open, "isTemplate": false],
                                   "live": jsonObject(live.state), "order": Live.order(items), "overlays": Live.overlays(items)]
        args.merge(live.others(than: open)) { a, _ in a }
        args.merge(what) { a, _ in a }
        guard let answer = view("pageStepView", args, as: PageAnswer.self) else { return nil }
        if pageState != answer.state { pageState = answer.state }
        if answer.liveChanged {
            live.adopt(app, answer.live)
            app.liveChanged()
        }
        return answer
    }

    /// What the core's answer to a key asks of the page: a move, a removal (asked first), Lägg till. A scroll follows
    /// the selection by itself; Avsluta is the bar's, which asks first.
    func perform(_ command: JSONValue) {
        let item = command["itemId"]?.string.flatMap { id in current?.items.first { $0.id == id } }
        switch command["type"]?.string {
        case "move": if let item, case let .number(by) = command["by"] { run("moveItem", ["itemId": item.id, "by": Int(by)]) }
        case "remove": removing = item
        case "add": addingSong = AddAt(after: afterFor(nil))
        default: break
        }
    }

    /// An overlay turned on over what is presented, or off (nil): the core's overlays' rules.
    func showOverlay(_ id: String?) {
        let change: [String: Any] = ["overlayId": id.map { $0 as Any } ?? NSNull()]
        if step(["change": change]) == nil, live.set(app, change) { app.liveChanged() }
    }

    /// Avsluta: nothing presented, and the page as that leaves it; without a page open, the live state alone.
    func endPresenting() {
        if step(["change": ["presentationId": NSNull(), "itemId": NSNull(), "partIndex": 0, "black": false]]) != nil { return }
        live.end(app)
        app.liveChanged()
    }

    /// Whether ▶ may start: not while another presentation is presented (`pageModelView`).
    var canStart: Bool {
        guard let open = selectedPresentation, let items = current?.items else { return false }
        let context: [String: Any] = ["presentationId": open, "isTemplate": false, "presenting": isLive, "live": jsonObject(live.state)]
        return view("pageModelView", ["state": jsonObject(pageState), "context": context, "order": Live.order(items)], as: PageModel.self)?.canStart ?? false
    }

    func searchSongs(_ query: String) -> [SongHit] {
        // In the app's language, as the web orders its library (the core's collation.rs).
        let hits = view("searchSongsView", ["query": query, "locale": Texts.language], as: [SongHit].self) ?? []
        app.note("searchSongsView")
        return hits
    }

    /// Sends a change to the core (queued for the server when synced); every window reads again what it changed, and
    /// this one says a refusal.
    @discardableResult
    func run(_ name: String, _ args: [String: Any]) -> String {
        let outcome = app.mutate(name, args)
        if outcome != "ok" { refusal = refusalText(outcome) }
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
