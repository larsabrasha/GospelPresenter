// The core's views as the web's pages read them (crates/gp-core/src/views.rs), decoded: the presentations page
// (`presentationListView`, `itemCountsView`, `trashEntriesView`), a presentation's page (`presentationPageView`), and
// presenting's keys and marks (`presentingKeyView`, `slideMarksView`). Only the fields this app shows are decoded.
import Foundation

/// `Presentation`, a row of `presentationListView`.
struct PresentationRow: Decodable, Identifiable, Hashable {
    let id: String, name: String, eventDate: String?, time: String?, location: String?, description: String?, updatedAt: Double?
    /// From `itemCountsView`; none when the presentation has no items.
    var itemCount = 0

    private enum CodingKeys: String, CodingKey { case id, name, eventDate, time, location, description, updatedAt }
}

/// The start page's three lists (spec 03 screen 1, apps/web/src/pages/dashboard.ts's `groupPresentations`): today by
/// time (no time last), upcoming soonest first, and the rest, past and undated alike, last changed first.
struct PresentationGroups {
    var today: [PresentationRow] = [], upcoming: [PresentationRow] = [], rest: [PresentationRow] = []

    init() {}

    init(_ all: [PresentationRow], today day: String) {
        func byTime(_ a: PresentationRow, _ b: PresentationRow) -> Int { compare(a.time ?? "99:99", b.time ?? "99:99") }
        func byLastChanged(_ a: PresentationRow, _ b: PresentationRow) -> Int { compare(b.updatedAt ?? -1, a.updatedAt ?? -1) }
        func byId(_ a: PresentationRow, _ b: PresentationRow) -> Int { compare(a.id, b.id) }
        func sorted(_ rows: [PresentationRow], _ by: [(PresentationRow, PresentationRow) -> Int]) -> [PresentationRow] {
            rows.sorted { a, b in by.lazy.map { $0(a, b) }.first { $0 != 0 }.map { $0 < 0 } ?? false }
        }
        today = sorted(all.filter { $0.eventDate == day }, [byTime, byLastChanged, byId])
        upcoming = sorted(all.filter { ($0.eventDate ?? "") > day }, [{ compare($0.eventDate ?? "", $1.eventDate ?? "") }, byTime, byId])
        rest = sorted(all.filter { $0.eventDate.map { $0 < day } ?? true }, [byLastChanged, byId])
    }

    var all: [PresentationRow] { today + upcoming + rest }
}

/// -1, 0 or 1, as JavaScript's comparators answer (strings by UTF-16 code units, as `localeCompare` does not but `<` does:
/// dates and times are ASCII, where the two agree).
private func compare<T: Comparable>(_ a: T, _ b: T) -> Int { a < b ? -1 : a > b ? 1 : 0 }

/// Today's date on this device, `YYYY-MM-DD`, as event dates are stored (`localToday`).
func localToday(_ now: Date = Date()) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: now)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

/// An entry of `trashEntriesView`; this app shows the presentations among them.
struct TrashRow: Decodable, Identifiable, Hashable { let kind: String, id: String, name: String, deletedAt: Double? }

/// Any JSON, kept as the core gave it: a slide, a theme and an overlay go on to the web's `SlideView` unchanged.
enum JSONValue: Codable, Hashable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .number(n): try c.encode(n)
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }

    subscript(_ key: String) -> JSONValue? { if case let .object(o) = self { o[key] } else { nil } }
    var string: String? { if case let .string(s) = self { s } else { nil } }

    /// Its JSON text, keys sorted, so the same value is the same text (a cache key).
    var text: String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? e.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "null"
    }
}

struct SlideLabel: Decodable, Hashable { let text: String, color: String }

/// A slide as `readItemSlides` gives it: what the lists show of it, and the whole of it for the web's `SlideView`.
struct Slide: Decodable, Hashable, Identifiable {
    let key: String, kind: String, text: String, label: SlideLabel?
    /// The picture of a picture slide: its blob's hash, and its thumbnail's.
    let image: String?, thumb: String?
    let raw: JSONValue
    var id: String { key }

    private enum Keys: String, CodingKey { case key, kind, text, label, image, thumb }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        key = try c.decode(String.self, forKey: .key)
        kind = try c.decode(String.self, forKey: .kind)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        label = try c.decodeIfPresent(SlideLabel.self, forKey: .label)
        image = try c.decodeIfPresent(String.self, forKey: .image)
        thumb = try c.decodeIfPresent(String.self, forKey: .thumb)
        raw = try JSONValue(from: decoder)
    }
}

/// `presentationPageView`: the presentation and its theme, its items in order, each item's slides by its id, and its
/// songs' arrangements.
struct PresentationPage: Decodable {
    struct Item: Decodable { let id: String, type: String?, title: String, sourceId: String, arrangementId: String?, note: String?, overlayId: String? }
    struct Slides: Decodable { let slides: [Slide], problem: String? }
    struct Arrangement: Decodable { let id: String, songId: String, name: String? }
    let presentation: PresentationRow?
    let theme: JSONValue?
    let items: [Item]
    let slides: [String: Slides]
    let arrangements: [Arrangement]
}

struct Arrangement: Identifiable, Hashable { let id: String, name: String? }

/// An item of the running order with its slides, as the columns show it.
struct ItemView: Identifiable, Hashable {
    let id: String, type: String, title: String, note: String?, slides: [Slide], arrangementId: String?, arrangements: [Arrangement]
    /// Why the item has no slides, if it has none: a song in the trash, a file gone.
    let problem: String?
    /// The overlay its slides are shown with, as `overlayView` reads it (Model.load fills it in).
    var overlay: JSONValue? = nil
    let overlayId: String?
}

/// A presentation's page, as the columns show it.
struct PresentationView {
    let id: String, name: String, eventDate: String?, time: String?, location: String?, description: String?
    var items: [ItemView]
    /// The presentation's theme as the core resolves it (its own, or the organisation's default).
    let theme: JSONValue?

    init?(_ page: PresentationPage) {
        guard let p = page.presentation else { return nil }
        (id, name, eventDate, time, location, description, theme) = (p.id, p.name, p.eventDate, p.time, p.location, p.description, page.theme)
        items = page.items.map { i in
            let shown = page.slides[i.id]
            let arrangements = i.type == "song" ? page.arrangements.filter { $0.songId == i.sourceId }.map { Arrangement(id: $0.id, name: $0.name) } : []
            return ItemView(id: i.id, type: i.type ?? "song", title: i.title, note: i.note, slides: shown?.slides ?? [],
                            arrangementId: i.arrangementId, arrangements: arrangements, problem: shown?.problem, overlayId: i.overlayId)
        }
    }
}

struct SongHit: Decodable, Identifiable, Hashable { let id: String, name: String }

/// A slide: its item, and its place among the item's slides.
struct SlideAt: Codable, Hashable { let itemId: String, partIndex: Int }

/// What the outputs show (`LivePointer`'s slide): no item before the first slide is shown; black is Släck.
struct Shown: Codable, Hashable {
    let itemId: String?, partIndex: Int, black: Bool

    /// `itemId` written as null when there is none, as the core reads it (the synthesized one leaves it out).
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(itemId, forKey: .itemId)
        try c.encode(partIndex, forKey: .partIndex)
        try c.encode(black, forKey: .black)
    }
}

/// A cell of `itemCountsView`'s pairs, [id, n].
enum CountCell: Decodable {
    case id(String), n(Int)
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .id(s) } else { self = .n(try c.decode(Int.self)) }
    }
}

/// What presenting holds (`Presenting`): whether it is on, what is shown, and the slide made ready for ↵.
struct Presenting: Codable, Hashable {
    var presenting: Bool, shown: Shown, picked: SlideAt?
    static let off = Presenting(presenting: false, shown: Shown(itemId: nil, partIndex: 0, black: false), picked: nil)
}

/// `slideMarksView`: the slide marked VISAS and the one marked NÄSTA (VISAS's item is null before a slide is shown).
struct SlideMarks: Decodable {
    struct At: Decodable { let itemId: String?, partIndex: Int }
    let shown: At?, next: At?
}
