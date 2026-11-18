// Presenting (docs/view-models.md, docs/layout-2-0.md "Live"): the app's live state, the same for every window, which
// presentation is presented and its slide, changed only by the core (`liveChangeView`: one presentation at a time, the
// overlays' rules); and the marks VISAS and NÄSTA (`slideMarksView`). A page's own state, its selection and the slide
// made ready, is the Model's (`Model.send`, `pageEventView`). It belongs to the presentation presented and goes on
// while another page is open.
import Foundation
import Observation
import Shell

/// What the outputs show once a slide is shown; black is Släck.
struct Pointer: Hashable { let itemId: String, partIndex: Int, black: Bool }

@MainActor
@Observable
final class Live {
    /// The app's live state, as the core left it.
    private(set) var state = LivePointer.idle
    /// The presentation presented; nil before Starta and after Avsluta.
    var id: String? { state.presentationId }
    var on: Bool { id != nil }
    /// Its page, read again with every change, so its order and slides are those shown.
    private(set) var page: PresentationView?
    private(set) var pointer: Pointer?
    private(set) var shownKey: String?
    private(set) var nextKey: String?

    /// The running order as the core takes it: each item's id and how many slides it has; a heading has none.
    static func order(_ items: [ItemView]) -> [[Any]] { items.map { [$0.id, $0.slides.count] } }

    /// A change of the live state as the core makes it: false when it refused (another presentation is presented).
    @discardableResult
    func set(_ m: Model, _ change: [String: Any]) -> Bool {
        struct Changed: Decodable { let pointer: LivePointer? }
        // The overlay each item of the presentation carries, for the overlays' rules.
        let items = change["presentationId"].flatMap { $0 as? String }.flatMap(m.page)?.items ?? page?.items ?? []
        let overlays = Dictionary(items.map { ($0.id, $0.overlayId.map { $0 as Any } ?? NSNull()) }, uniquingKeysWith: { a, _ in a })
        guard let next = m.view("liveChangeView", ["pointer": jsonObject(state), "change": change, "overlays": overlays], as: Changed.self)?.pointer else { return false }
        if next.presentationId != state.presentationId { page = next.presentationId.flatMap(m.page) }
        state = next
        marks(m)
        return true
    }

    /// Avsluta: nothing presented.
    func end(_ m: Model) { set(m, ["presentationId": NSNull(), "itemId": NSNull(), "partIndex": 0, "black": false]) }

    /// After a change or a pull: the presented page read again, its marks with it; a presentation gone ends it.
    func reload(_ m: Model) {
        guard let id else { return }
        page = m.page(id)
        if page == nil { end(m) } else { marks(m) }
    }

    private func marks(_ m: Model) {
        let shown = state.itemId.map { Pointer(itemId: $0, partIndex: state.partIndex, black: state.black) }
        var marks: SlideMarks?
        if on, let items = page?.items {
            let at: [String: Any] = ["itemId": state.itemId ?? NSNull(), "partIndex": state.partIndex, "black": state.black]
            marks = m.view("slideMarksView", ["order": Self.order(items), "shown": at], as: SlideMarks.self)
        }
        func key(_ at: SlideMarks.At?) -> String? { at.flatMap { a in a.itemId.map { "\($0)/\(a.partIndex)" } } }
        if pointer != shown { pointer = shown }
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
