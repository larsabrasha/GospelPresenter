// What the windows show, as the Rust core answers it, and the mutations the buttons send it.
import Foundation
import Observation
import Shell
import SwiftUI

struct PresentationRow: Decodable, Identifiable, Hashable {
    let id: String, name: String, eventDate: String?, time: String?, location: String?, itemCount: Int
}
struct SlideLabel: Decodable, Hashable { let text: String, color: String }
struct Slide: Decodable, Hashable, Identifiable {
    let key: String, kind: String, text: String, label: SlideLabel?
    var id: String { key }
}
struct Arrangement: Decodable, Identifiable, Hashable { let id: String, name: String? }
struct ItemView: Decodable, Identifiable, Hashable {
    let id: String, type: String, title: String, note: String?, slides: [Slide], arrangementId: String?, arrangements: [Arrangement]
}
struct TrashRow: Decodable, Identifiable, Hashable { let id: String, name: String, deletedAt: Int }
struct PresentationView: Decodable {
    let id: String, name: String, eventDate: String?, time: String?, location: String?, description: String?, items: [ItemView]
}
struct SongHit: Decodable, Identifiable, Hashable { let id: String, name: String }

/// A slide: its item, and its place among the item's slides.
struct SlideAt: Codable, Hashable { let itemId: String, partIndex: Int }
/// What the outputs show; black is Släck.
struct Pointer: Codable, Hashable { let itemId: String, partIndex: Int, black: Bool }
/// The core's answer to a key or a click while presenting (live.rs).
struct LiveState: Decodable {
    let presenting: Bool, pointer: Pointer?, picked: SlideAt?, shown: String?, next: String?
}

@MainActor
@Observable
final class Model {
    let core: Core
    var presentations: [PresentationRow] = []
    var selectedPresentation: String? {
        didSet { if oldValue != selectedPresentation { selectedItem = nil; presenting = false; pointer = nil; picked = nil; load() } }
    }
    var current: PresentationView?
    var selectedItem: String?
    var trash: [TrashRow] = []
    /// Presenting: what is shown, the slide made ready, and the marks, all as the core answered.
    var presenting = false
    var pointer: Pointer?
    var picked: SlideAt?
    var shownKey: String?
    var nextKey: String?
    var refusal: String?
    var role = "user"
    var status = "Rust-kärna redo"

    init() {
        let dir = ProcessInfo.processInfo.environment["GP_MAC_DATA"] ?? FileManager.default.currentDirectoryPath
        let path = "\(dir)/app.sqlite"
        if !FileManager.default.fileExists(atPath: path) { try! FileManager.default.copyItem(atPath: "\(dir)/demo.sqlite", toPath: path) }
        let db = try! Database(path: path)
        db.exec("PRAGMA journal_mode = WAL")
        core = Core(db: db)
        refresh()
        selectedPresentation = presentations.first?.id
    }

    private func note(_ what: String) {
        status = "\(what) · \(core.lastSqlCalls) SQL · \(Int(core.lastMicros)) µs"
    }

    func refresh() {
        presentations = core.view("presentationsView", as: [PresentationRow].self) ?? []
        trash = core.view("trashView", as: [TrashRow].self) ?? []
    }

    func load() {
        current = selectedPresentation.flatMap { core.view("presentationView", ["id": $0], as: PresentationView.self) }
        note("presentationView")
        live(["type": "none"])
    }

    func searchSongs(_ query: String) -> [SongHit] {
        let hits = core.view("searchSongsView", ["query": query], as: [SongHit].self) ?? []
        note("searchSongsView")
        return hits
    }

    /// Sends a mutation to the core, then reads again what it changed.
    @discardableResult
    func run(_ name: String, _ args: [String: Any]) -> String {
        let outcome = core.mutate(["name": name, "args": args, "ctx": ["userId": "mac", "role": role]])
        note("\(name): \(outcome)")
        if outcome != "ok" { refusal = refusalText(outcome) }
        refresh()
        load()
        return outcome
    }

    func newId() -> String { UUID().uuidString.lowercased() }

    // ------------------------------------------------------------ live

    /// Sends a key or a click to the core's presenting reducer, with what is held now, and keeps what it answers.
    func live(_ action: [String: Any]) {
        guard let pid = selectedPresentation else { return }
        func encoded<T: Encodable>(_ v: T?) -> Any { v.flatMap { try? JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull() }
        let order: [[Any]] = (current?.items ?? []).map { [$0.id, $0.slides.count] }
        let args: [String: Any] = ["presentationId": pid, "order": order, "presenting": presenting, "pointer": encoded(pointer), "picked": encoded(picked), "action": action]
        guard let state = core.view("liveView", args, as: LiveState.self) else { return }
        // Set only what changed: each is observed on its own.
        if presenting != state.presenting { presenting = state.presenting }
        if pointer != state.pointer { pointer = state.pointer }
        if picked != state.picked { picked = state.picked }
        if shownKey != state.shown { shownKey = state.shown }
        if nextKey != state.next { nextKey = state.next }
        if let at = state.picked ?? (action["type"] as? String == "step" ? state.pointer.map { SlideAt(itemId: $0.itemId, partIndex: $0.partIndex) } : nil) {
            if selectedItem != at.itemId { selectedItem = at.itemId }
        }
    }

    func key(_ item: ItemView, _ n: Int) -> String { "\(item.id)/\(n)" }

    /// What the outputs show: nothing before presenting and after Släck.
    var liveSlide: Slide? {
        guard presenting, let p = pointer, !p.black, let item = current?.items.first(where: { $0.id == p.itemId }), item.slides.indices.contains(p.partIndex) else { return nil }
        return item.slides[p.partIndex]
    }
}

/// What a refusal says to someone using the app.
func refusalText(_ code: String) -> String {
    switch code {
    case "forbidden": "Din roll får inte göra det här."
    case "not-found": "Det finns inte längre."
    case "invalid-args": "Något av fälten är inte giltigt."
    case "limit": "En presentation kan ha högst 100 inslag."
    case "not-in-trash": "Bara det som ligger i papperskorgen kan raderas för gott."
    case "theme-not-found": "Temat finns inte."
    case "not-a-song": "Bara en sång har arrangemang."
    default: "Det gick inte (\(code))."
    }
}

extension PresentationRow {
    /// "sön 8 november 2026 · 11:00 · Kyrksalen", leaving out what is not set.
    var subtitle: String { eventLine(eventDate, time, location) }
}

func eventLine(_ date: String?, _ time: String?, _ location: String?) -> String {
    let parse = DateFormatter()
    parse.dateFormat = "yyyy-MM-dd"
    parse.locale = Locale(identifier: "en_US_POSIX")
    let show = DateFormatter()
    show.locale = Locale(identifier: "sv_SE")
    show.dateFormat = "EEE d MMMM yyyy"
    let day = date.flatMap { parse.date(from: $0) }.map { show.string(from: $0) }
    return [day, time, location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
}

extension Color {
    /// "#c73434".
    init(hex: String) {
        let v = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
