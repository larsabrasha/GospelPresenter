// Presenting, as the web's presentation page does it (docs/layout-2-0.md, "Live"): the keys through the core's
// `presentingKeyView` and the marks VISAS and NÄSTA through its `slideMarksView`; Starta, a slide tapped and Avsluta
// set what presenting holds. It belongs to the presentation presented and goes on while another page is open.
import Foundation
import Observation
import Shell

/// What the outputs show once a slide is shown; black is Släck.
struct Pointer: Hashable { let itemId: String, partIndex: Int, black: Bool }

@MainActor
@Observable
final class Live {
    /// The presentation presented; nil before Starta and after Avsluta.
    private(set) var id: String?
    /// Its page, read again with every change, so its order and slides are those shown.
    private(set) var page: PresentationView?
    /// What presenting holds, as the core's keys left it; what the pages read is set from it, each only when it changed.
    private var state = Presenting.off
    var on: Bool { id != nil }
    private(set) var pointer: Pointer?
    /// The slide made ready, outlined in blue: ↵ shows it; before presenting, a slide pointed out on the open page.
    private(set) var picked: SlideAt?
    private(set) var shownKey: String?
    private(set) var nextKey: String?

    /// The running order as the core takes it: each item's id and how many slides it has; a heading has none.
    private func order(_ items: [ItemView]) -> [[Any]] { items.map { [$0.id, $0.slides.count] } }

    /// A page opened: before presenting, a slide pointed out on another page is let go.
    func opened(_ m: Model) {
        if !on, picked.map({ p in !(m.current?.items.contains { $0.id == p.itemId } ?? false) }) ?? false { apply(.off, items: []) }
    }

    /// After a change or a pull: the presented page read again, its marks with it; a presentation gone ends it.
    func reload(_ m: Model) {
        guard let id else { return }
        page = m.page(id)
        if page == nil { self.id = nil; apply(.off, items: [], m) } else { apply(state, items: page!.items, m) }
    }

    /// A key, a tap or a button on the open page: `start`, `stop`, `show` (a slide tapped: shown while presenting, else
    /// pointed out), and the keys `step`, `pick`, `enter`, `black`, `escape`.
    func press(_ m: Model, _ action: [String: Any]) {
        guard let open = m.selectedPresentation, let items = m.current?.items else { return }
        if on && id != open && action["type"] as? String != "start" { return }
        var next = state
        switch action["type"] as? String {
        case "start":
            id = open
            page = m.current
            next = Presenting(presenting: true, shown: Shown(itemId: nil, partIndex: 0, black: false), picked: nil)
        case "stop":
            id = nil
            page = nil
            next = .off
        case "show":
            let at = SlideAt(itemId: action["itemId"] as? String ?? "", partIndex: action["partIndex"] as? Int ?? 0)
            if state.presenting { next.shown = Shown(itemId: at.itemId, partIndex: at.partIndex, black: false); next.picked = nil } else { next.picked = at }
        default:
            func json<T: Encodable>(_ v: T) -> Any { (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(v), options: .fragmentsAllowed)) ?? NSNull() }
            guard let answered = m.view("presentingKeyView", ["order": order(items), "state": json(state), "key": action], as: Presenting.self) else { return }
            next = answered
        }
        apply(next, items: items, m)
        // The item of the slide made ready, or of the one stepped to, is the running order's selection.
        let at = next.picked.map(\.itemId) ?? (action["type"] as? String == "step" ? next.shown.itemId : nil)
        if let at, m.selectedItem != at { m.selectedItem = at }
    }

    private func apply(_ next: Presenting, items: [ItemView], _ m: Model? = nil) {
        state = next
        let shown = next.shown.itemId.map { Pointer(itemId: $0, partIndex: next.shown.partIndex, black: next.shown.black) }
        var marks: SlideMarks?
        if next.presenting, let m, let json = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(next.shown)) {
            marks = m.view("slideMarksView", ["order": order(items), "shown": json], as: SlideMarks.self)
        }
        func key(_ at: SlideMarks.At?) -> String? { at.flatMap { a in a.itemId.map { "\($0)/\(a.partIndex)" } } }
        if pointer != shown { pointer = shown }
        if picked != next.picked { picked = next.picked }
        if shownKey != key(marks?.shown) { shownKey = key(marks?.shown) }
        if nextKey != key(marks?.next) { nextKey = key(marks?.next) }
    }

    /// What the outputs show: nothing before presenting, before the first slide and after Släck.
    var slide: Slide? {
        guard let p = pointer, !p.black, let item = page?.items.first(where: { $0.id == p.itemId }), item.slides.indices.contains(p.partIndex) else { return nil }
        return item.slides[p.partIndex]
    }

    /// The presented page's theme, for the live picture.
    var theme: JSONValue? { page?.theme }
}

/// A slide's place, as the marks name it.
func slideKey(_ itemId: String, _ n: Int) -> String { "\(itemId)/\(n)" }
