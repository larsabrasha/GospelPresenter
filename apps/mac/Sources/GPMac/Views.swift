// The core's views as the web's pages read them (crates/gp-core/src/views.rs), decoded: the start page
// (`startPageView`), a presentation's page (`presentationPageView`), presenting's keys and marks (`presentingKeyView`,
// `slideMarksView`), and what a page offers (docs/view-models.md). Only the fields this app shows are decoded.
import Foundation

/// A presentation as a list shows it (`Presentation`), with its number of items where the view gives it.
struct PresentationRow: Decodable, Identifiable, Hashable {
    let id: String, name: String, eventDate: String?, time: String?, location: String?, description: String?, updatedAt: Double?
    var itemCount: Int? = nil
}

/// One of the start page's lists as the core groups them for every shell (`startPageView`, docs/view-models.md):
/// Idag, Kommande or Senast ändrade, in their order, an empty one left out, and whether its rows show their date and
/// its year.
struct StartList: Decodable, Identifiable, Hashable {
    let id: String, title: String, showDate: Bool, withYear: Bool, rows: [PresentationRow]
}

/// Today's date on this device, `YYYY-MM-DD`, as event dates are stored (`localToday`).
func localToday(_ now: Date = Date()) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: now)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

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

    /// As JSONSerialization takes it: the value handed back to the core in a view's arguments.
    var any: Any {
        switch self {
        case .null: NSNull()
        case let .bool(b): b
        case let .number(n): n
        case let .string(s): s
        case let .array(a): a.map(\.any)
        case let .object(o): o.mapValues(\.any)
        }
    }

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
    /// An audio file's name, on an audio item's slide.
    var audioName: String? { raw["audio"]?["name"]?.string }
    /// Shown small, as its slide, on a phone's row: a picture, a video, a slideshow's page (the web's SlideRow); a song or
    /// a reading by its words.
    var pictured: Bool { kind == "media" || raw["custom"].map { $0 != .null } ?? false }

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
    struct Slides: Decodable { let slides: [Slide], problem: String?, audio: AudioFile?, video: VideoFile? }
    struct Arrangement: Decodable { let id: String, songId: String, name: String? }
    let presentation: PresentationRow?
    let theme: JSONValue?
    let items: [Item]
    let slides: [String: Slides]
    let songs: [JSONValue]
    let arrangements: [Arrangement]
    let overlays: [JSONValue]
}

struct Arrangement: Identifiable, Hashable { let id: String, name: String? }

/// An audio item's file, as its slides give it: what its preview plays.
struct AudioFile: Decodable, Hashable { let hash: String, fileName: String }
/// A video item's file, its still and its thumbnail.
struct VideoFile: Decodable, Hashable { let hash: String, fileName: String, contentType: String?, stillHash: String?, thumbHash: String? }

/// An entry a menu offers, as the core works it out for every shell (`itemActionsView`, `presentationActionsView`;
/// docs/view-models.md): its id, its text's key, whether it can be chosen, and a submenu's choices.
struct MenuAction: Decodable, Hashable {
    /// An arrangement's (`name` nil: "Arrangemang {n}"; `text`, a key, for Original), or an overlay's (`text` for Ingen).
    /// A kind to add (Lägg till efter ›) has its icon, and Programpunkt is set `apart` under a line.
    struct Choice: Decodable, Hashable { let id: String, name: String?, n: Int?, text: String?, icon: String?, apart: Bool? }
    let id: String, text: String, enabled: Bool, destructive: Bool
    /// The icon's name, the app's own (`lookView`'s icons); this app's SF Symbol for it is `Look.symbol`.
    let icon: String?
    let choices: [Choice]?
    let chosen: String?
}

/// A menu's sections, each a group of the core's.
struct MenuGroups: Decodable {
    struct Group: Decodable, Hashable { let id: String, actions: [MenuAction] }
    let groups: [Group]
}

/// An item of the running order with its slides, as the columns show it.
struct ItemView: Identifiable, Hashable {
    let id: String, type: String, title: String, note: String?, slides: [Slide], arrangementId: String?, arrangements: [Arrangement]
    /// Why the item has no slides, if it has none: a song in the trash, a file gone.
    let problem: String?
    /// The overlay its slides are shown with, as `overlayView` reads it (Model.load fills it in).
    var overlay: JSONValue? = nil
    let overlayId: String?
    /// A song item's song as the page read it (nil when it is gone), for its menu (`itemActionsView`).
    let song: JSONValue?
    /// An audio or video item's file, for its preview before presenting.
    var audio: AudioFile? = nil
    var video: VideoFile? = nil
}

/// A presentation's page, as the columns show it.
struct PresentationView {
    let id: String, name: String, eventDate: String?, time: String?, location: String?, description: String?
    var items: [ItemView]
    /// The presentation's theme as the core resolves it (its own, or the organisation's default).
    let theme: JSONValue?
    /// The organisation's overlays, for an item's Överlägg ›.
    let overlays: [JSONValue]

    init?(_ page: PresentationPage) {
        guard let p = page.presentation else { return nil }
        (id, name, eventDate, time, location, description, theme, overlays) = (p.id, p.name, p.eventDate, p.time, p.location, p.description, page.theme, page.overlays)
        items = page.items.map { i in
            let shown = page.slides[i.id]
            let song = i.type == "song" ? page.songs.first { $0["id"]?.string == i.sourceId } : nil
            let arrangements = i.type == "song" ? page.arrangements.filter { $0.songId == i.sourceId }.map { Arrangement(id: $0.id, name: $0.name) } : []
            return ItemView(id: i.id, type: i.type ?? "song", title: i.title, note: i.note, slides: shown?.slides ?? [],
                            arrangementId: i.arrangementId, arrangements: arrangements, problem: shown?.problem, overlayId: i.overlayId, song: song,
                            audio: shown?.audio, video: shown?.video)
        }
    }
}

struct SongHit: Decodable, Identifiable, Hashable { let id: String, name: String, author: String? }

/// A slide: its item, and its place among the item's slides.
struct SlideAt: Codable, Hashable { let itemId: String, partIndex: Int }

/// A value as JSONSerialization takes it, for the core's arguments.
func jsonObject<T: Encodable>(_ v: T) -> Any {
    (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(v), options: .fragmentsAllowed)) ?? NSNull()
}

/// The app's live state, the same for every window of the device (`liveChangeView`, docs/view-models.md): the
/// presentation presented, its slide (no item before the first is shown), black (Släck), the overlay, numbered.
struct LivePointer: Codable, Hashable {
    var presentationId: String?
    var itemId: String?
    var partIndex: Int
    var black: Bool
    var overlayId: String?
    var rev: Int
    static let idle = LivePointer(presentationId: nil, itemId: nil, partIndex: 0, black: false, overlayId: nil, rev: 0)
}

/// A presentation page's own state (`pageEventView`): the item selected, the slide made ready (↵ shows it), the last
/// thing added, a number typed; `presenting` and `followed` are what the core last saw of the live state.
struct PageState: Codable, Hashable {
    var selectedId: String?
    var picked: SlideAt?
    var lastAddedId: String?
    var typed = ""
    var presenting = false
    var followed: String?

    init(selectedId: String? = nil, presenting: Bool = false, followed: String? = nil) {
        (self.selectedId, self.presenting, self.followed) = (selectedId, presenting, followed)
    }

    /// As the core keeps it: a field it has not set yet is left out, and reads as its default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        selectedId = try c.decodeIfPresent(String.self, forKey: .selectedId)
        picked = try c.decodeIfPresent(SlideAt.self, forKey: .picked)
        lastAddedId = try c.decodeIfPresent(String.self, forKey: .lastAddedId)
        typed = try c.decodeIfPresent(String.self, forKey: .typed) ?? ""
        presenting = try c.decodeIfPresent(Bool.self, forKey: .presenting) ?? false
        followed = try c.decodeIfPresent(String.self, forKey: .followed)
    }
}

/// The core's answer to a page's event: its state, a change to the live state, what the page does, and whether the
/// event was the page's.
struct PageAnswer: Decodable {
    let state: PageState
    let live: JSONValue?
    let command: JSONValue?
    let handled: Bool
}

/// What the page shows of its state (`pageModelView`): the state the live state leaves it in, and whether ▶ may start.
struct PageModel: Decodable { let state: PageState, canStart: Bool }

/// `slideMarksView`: the slide marked VISAS and the one marked NÄSTA (VISAS's item is null before a slide is shown).
struct SlideMarks: Decodable {
    struct At: Decodable { let itemId: String?, partIndex: Int }
    let shown: At?, next: At?
}
