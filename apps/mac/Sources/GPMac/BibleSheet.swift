// Lägg till Bibeltext (spec 05; the web's BibleTab.tsx): a translation, then a reference searched ("Joh 3:16",
// `verseSearchPlanView`) or a passage browsed (a book, the start's chapter and verse, the end's, `bibleBrowseView`),
// the slides it makes previewed as the outputs will show them (`bibleSlidesView`), and added (`addBibleToPresentation`),
// at most the verses an item holds (`rulesView`'s limits), asked first when a search finds more (BIBLE-R14). The
// translation's text is read where the core reads it (`bibleView`): this device's when kept, else fetched for the
// sheet only (`SyncClient.fetchedBibleText`), as the web's fetchedBibles. The sheet stays open after an add (D15).
import Shell
import SwiftUI

private struct Verse: Codable, Hashable { let b: String, c: Int, v: Int, t: String }

/// What bibleView reads of a translation: its books, a book's chapters, a chapter's verses ([chapter, verse, text]),
/// a passage's verses.
private struct BibleRead: Decodable {
    let books: [String]
    let chapters: [Int]?
    let verses: [[JSONValue]]?
    let passage: [Verse]?
}

private struct Browsed: Decodable {
    struct Picked: Decodable { let from: Int, to: Int? }
    let browse: JSONValue
    let prompt: String
    let verseChapter: Int?
    let picked: Picked?
    let ask: JSONValue
}

private struct Plan: Decodable { let codes: [String], from: [Int], to: [Int] }
private struct Preview: Decodable { let title: String, label: String, slides: [JSONValue] }
private struct BookNames: Decodable { let sv: String, en: String }

struct BibleSheet: View {
    @Environment(Model.self) private var model
    let at: AddKindAt
    @State private var bibleId: String?
    @State private var query = ""
    @State private var browse: JSONValue?
    /// A translation's text fetched for this sheet, where the device does not keep it.
    @State private var held: (hash: String, core: Core)?
    @State private var fetching = false
    @State private var added: String?
    @State private var asking = false

    @Environment(\.horizontalSizeClass) private var sizeClass
    /// A phone: the picker over the preview, not beside it.
    private var narrow: Bool { sizeClass == .compact }

    private var bibles: [BibleRow] { model.view("biblesView", ["locale": Texts.language], as: [BibleRow].self) ?? [] }

    /// bibleView over the translation's text, wherever this device has it.
    private func read(_ bible: BibleRow, _ ask: [String: Any] = [:]) -> BibleRead? {
        var args = ask
        args["hash"] = bible.contentHash
        if bible.stored { return model.view("bibleView", args, as: BibleRead.self) }
        guard let held, held.hash == bible.contentHash else { return nil }
        return held.core.view("bibleView", args, as: BibleRead.self)
    }

    private func browsed(_ event: [String: Any]? = nil) -> Browsed? {
        var args: [String: Any] = ["browse": browse?.any ?? NSNull()]
        if let event { args["event"] = event }
        return model.view("bibleBrowseView", args, as: Browsed.self)
    }

    private func bookName(_ code: String) -> String {
        let n = model.view("bibleBookNamesView", ["codes": [code]], as: [BookNames].self)?.first
        return (Texts.language == "sv" ? n?.sv : n?.en) ?? code
    }

    var body: some View {
        let bible = bibles.first { $0.id == bibleId } ?? bibles.first
        Group {
            if let bible { content(bible) } else {
                ContentUnavailableView { Label(t("bible.none"), systemImage: "book") } description: { Text(t("bible.noneText")) }
            }
        }
        .task(id: bible?.contentHash) { await fetch(bible) }
        #if os(macOS)
        .frame(minWidth: 900, minHeight: 600)
        #endif
    }

    /// A translation not kept here, fetched for the sheet.
    private func fetch(_ bible: BibleRow?) async {
        guard let bible, !bible.stored, held?.hash != bible.contentHash, case let .synced(client) = model.store else { return }
        fetching = true
        defer { fetching = false }
        if let core = await client.fetchedBibleText(bible.contentHash) { held = (bible.contentHash, core) }
    }

    private func content(_ bible: BibleRow) -> some View {
        let books = read(bible)?.books ?? []
        let now = browse == nil ? nil : browsed()
        let passage = chosen(bible, books: books, now: now)
        let limit = model.view("rulesView", as: Rules.self)?.limits.versesPerItem ?? 500
        let shown = Array(passage.prefix(limit))
        let preview = shown.isEmpty ? nil : model.view("bibleSlidesView", ["translation": bible.abbreviation, "verses": shown.map(jsonObject)], as: Preview.self)
        let sides = AnyLayout(narrow ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0)))
        return sides {
            VStack(alignment: .leading, spacing: 12) {
                if bibles.count > 1 {
                    Picker(t("bible.translation"), selection: Binding(get: { bible.id }, set: { bibleId = $0; browse = nil })) {
                        ForEach(bibles) { Text($0.name).tag($0.id) }
                    }
                }
                if fetching { ProgressView() }
                // A field of the sheet's own, as the web's: a system search would cover the bar's Lägg till while typing.
                TextField(t("bible.search"), text: $query)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("bible-search")
                    .onChange(of: query) { _, _ in browse = nil }
                if query.trimmingCharacters(in: .whitespaces).isEmpty { picker(bible, books: books, now: now) }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(width: narrow ? nil : 380)
            .fixedSize(horizontal: false, vertical: narrow && !query.isEmpty)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if let preview {
                        Text(preview.title).font(.headline).accessibilityIdentifier("bible-title")
                        ForEach(Array(preview.slides.enumerated()), id: \.offset) { _, s in
                            if let slide = try? JSONDecoder().decode(Slide.self, from: JSONEncoder().encode(s)) {
                                SlideThumbnail(slide: slide, theme: model.current?.theme).clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }
                }
                .padding(20)
            }
            .frame(maxWidth: .infinity)
        }
        .sheetBar(t("presentation.addKind", ["kind": t("add.bible").lowercased()]), cancel: t("common.close"),
                  confirm: preview.map { t("presentation.addSong", ["name": $0.title]) } ?? t("presentation.add"), disabled: shown.isEmpty) {
            if passage.count > shown.count { asking = true; return false }
            return add(bible, shown)
        }
        .confirmationDialog(t("bible.truncatedTitle"), isPresented: $asking, titleVisibility: .visible) {
            Button(t("presentation.add")) { _ = add(bible, shown) }
        } message: { Text(t("bible.truncated", ["total": passage.count, "n": shown.count])) }
    }

    /// The verses chosen: a browse's passage, else a search's.
    private func chosen(_ bible: BibleRow, books: [String], now: Browsed?) -> [Verse] {
        if let now, case let .object(ask) = now.ask { return read(bible, ask.mapValues(\.any))?.passage ?? [] }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !books.isEmpty, let plan = model.view("verseSearchPlanView", ["query": q, "available": books], as: Plan.self) else { return [] }
        return read(bible, ["passage": ["books": plan.codes, "from": plan.from, "to": plan.to]])?.passage ?? []
    }

    /// The browse: the books, then the chapters and verses of each step, its crumbs to go back.
    @ViewBuilder private func picker(_ bible: BibleRow, books: [String], now: Browsed?) -> some View {
        if let now, case let .object(b) = now.browse, case let .object(ask) = now.ask {
            let got = read(bible, ask.mapValues(\.any))
            let step = b["step"]?.string ?? "book"
            HStack {
                Button(t("common.back"), systemImage: "chevron.left") { browse = nil }.labelStyle(.iconOnly)
                Button(bookName(b["book"]?.string ?? "")) { go(["type": "step", "step": "book"]) }
            }
            Text(t(now.prompt)).foregroundStyle(.orange).font(.subheadline)
            ScrollView {
                if step == "book" {
                    grid(books.map { ($0, bookName($0)) }) { go(["type": "book", "book": $0]) }
                } else if step == "startChapter" || step == "endChapter" {
                    grid((got?.chapters ?? []).map { ("\($0)", "\($0)") }) { go(["type": "chapter", "n": Int($0) ?? 1]) }
                } else if let verses = got?.verses {
                    let numbers = verses.compactMap { $0.count > 1 ? $0[1].number.map(Int.init) : nil }
                    grid(numbers.map { ("\($0)", "\($0)") }, picked: { n in now.picked.map { p in (Int(n) ?? 0) >= p.from && (p.to == nil || (Int(n) ?? 0) <= p.to!) } ?? false }) {
                        go(["type": "verse", "n": Int($0) ?? 1])
                    }
                }
            }
        } else {
            ScrollView { grid(books.map { ($0, bookName($0)) }) { browse = model.view("bibleBrowseView", ["browse": NSNull(), "event": ["type": "book", "book": $0]], as: Browsed.self)?.browse } }
        }
    }

    private func go(_ event: [String: Any]) { browse = browsed(event)?.browse ?? browse }

    private func grid(_ cells: [(String, String)], picked: @escaping (String) -> Bool = { _ in false }, _ tap: @escaping (String) -> Void) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: cells.first.map { $0.1.count > 3 } == true ? 150 : 52), spacing: 6)], spacing: 6) {
            ForEach(cells, id: \.0) { id, text in
                Button { tap(id) } label: { Text(text).lineLimit(1).frame(maxWidth: .infinity, minHeight: 32) }
                    .buttonStyle(.bordered).tint(picked(id) ? Color.sky : nil)
                    .accessibilityIdentifier("bible-\(id)")
            }
        }
    }

    /// The verses added as one item after the last one added; the sheet stays open and starts over.
    private func add(_ bible: BibleRow, _ verses: [Verse]) -> Bool {
        guard let pid = model.selectedPresentation, !verses.isEmpty else { return false }
        let itemId = model.newId()
        let args: [String: Any] = ["itemId": itemId, "presentationId": pid, "bibleId": bible.id, "translation": bible.abbreviation,
                                   "verses": verses.map(jsonObject), "afterItemId": (added ?? at.after) ?? NSNull()]
        guard model.run("addBibleToPresentation", args) == "ok" else { return false }
        model.added(itemId)
        added = itemId
        (query, browse) = ("", nil)
        return false
    }
}

/// The limits the core's mutators hold to (`rulesView`), as far as this app reads them.
private struct Rules: Decodable { struct Limits: Decodable { let versesPerItem: Int }; let limits: Limits }
