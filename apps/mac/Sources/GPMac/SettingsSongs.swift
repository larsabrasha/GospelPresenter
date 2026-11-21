// Sånger (the web's Songs.tsx, SongImport.tsx and songImport.ts): the library by name in the device's language, the
// song search's best matches first while words are typed (`searchSongsView`), + Ny sång, a song renamed or put in the
// trash, and ProPresenter files imported: each read by the core (`proPresenterSongView`), the namesakes found by it
// (`songNamesakesView`, `songImportDuplicatesView`), each duplicate's choice the person's, then `importSongs`.
import SwiftUI
import UniformTypeIdentifiers

struct SongRow: Decodable, Identifiable, Hashable { let id: String, name: String, author: String? }
struct SongPartRow: Decodable, Identifiable, Hashable { let id: String, songId: String, labelId: String?, content: String }

struct SongsPage: View {
    @Environment(Model.self) private var model
    @State private var query = ""
    @State private var prompt: TextPrompt?
    @State private var trashing: SongRow?
    @State private var importing = false
    @State private var plan: ImportPlan?
    @State private var opened: String?
    @State private var message: String?
    @State private var sort = "name"
    @State private var picking = Picking()
    @State private var trashingMany = false

    private struct SongList: Decodable {
        struct Sort: Decodable, Hashable { let id: String, text: String }
        struct Section: Decodable { let letter: String?, rows: [SongRow] }
        let sorts: [Sort], sort: String, sections: [Section], index: Bool
    }

    var body: some View {
        let list = model.view("songListView", ["sort": sort, "locale": Texts.language], as: SongList.self)
        let all = list?.sections.flatMap(\.rows) ?? []
        let q = query.trimmingCharacters(in: .whitespaces)
        // While words are typed, the search's best matches first, in one run; else the list's sections.
        let sections: [SongList.Section] = q.isEmpty ? list?.sections ?? [] : [SongList.Section(letter: nil, rows: model.view("searchSongsView", ["query": q, "locale": Texts.language], as: [SongRow].self) ?? [])]
        let songs = sections.flatMap(\.rows)
        ScrollViewReader { proxy in
            List(selection: listSelection($picking)) {
                ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                    Section(section.letter ?? "") {
                        ForEach(section.rows) { s in songRow(s) }
                    }
                    .id(section.letter ?? "")
                }
            }
            .libraryPicking(picking, open: { opened = $0 }, remove: { trashingMany = true }) { ids in
                if ids.count == 1, let s = songs.first(where: { ids.contains($0.id) }) {
                    Button(t("palette.open"), systemImage: "arrow.up.forward.square") { opened = s.id }
                    ActionButtons(actions: lib?.row ?? []) { act($0, s) }
                } else {
                    ActionButtons(actions: lib?.picked ?? []) { _ in picking.ids = ids; trashingMany = true }
                }
            }
            #if os(iOS)
            // The letters along the edge, from as many songs as the core says, while not searching.
            .overlay(alignment: .trailing) {
                if q.isEmpty, list?.index == true {
                    LetterIndex(letters: sections.compactMap(\.letter)) { l in proxy.scrollTo(l, anchor: .top) }
                }
            }
            #endif
        }
        // Ny sång and Importera floating at the bottom right, as the web's song list has them.
        .floatingAdd(lib, shown: !picking.on, add: { create(all) }, extra: { importing = true })
        .navigationDestination(for: String.self) { id in SongEditorPage(id: id) }
        .navigationDestination(item: $opened) { id in SongEditorPage(id: id) }
        .overlay {
            if all.isEmpty { ContentUnavailableView(t("songs.emptyTitle"), systemImage: "music.note", description: Text(t("songs.emptyText"))) }
            else if songs.isEmpty { ContentUnavailableView(t("songs.noHits"), systemImage: "magnifyingglass") }
        }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .toolbar {
            if !picking.on {
                ToolbarItem(placement: .primaryAction) { SortMenu(sorts: (list?.sorts ?? []).map { ($0.id, $0.text) }, selection: $sort) }
            }
            PickingToolbar(picking: $picking, shown: lib?.pick ?? false) {
                ActionButtons(actions: lib?.picked ?? []) { _ in trashingMany = true }
            }
        }
        .confirmationDialog(t("common.delete"), isPresented: $trashingMany) {
            Button(t("common.delete"), role: .destructive) {
                for id in picking.ids { message = change(model, "trashSong", ["id": id, "at": nowMs()]) ?? message }
                picking.end()
            }
        } message: { Text(picking.ids.count == 1 ? t("song.trashConfirm", ["name": songs.first { picking.ids.contains($0.id) }?.name ?? ""]) : t("library.trashMany", ["n": picking.ids.count])) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "pro") ?? .data], allowsMultipleSelection: true) { result in
            guard case let .success(urls) = result else { return }
            read(urls, library: all)
        }
        .sheet(item: $plan) { p in ImportDuplicatesSheet(plan: p) { choices in message = send(p, choices) } }
        .textPrompt($prompt)
        .confirmationDialog(t("song.trash"), isPresented: Binding(get: { trashing != nil }, set: { if !$0 { trashing = nil } }), presenting: trashing) { s in
            Button(t("song.trash"), role: .destructive) { message = change(model, "trashSong", ["id": s.id, "at": nowMs()]) }
        } message: { s in Text(trashText(s)) }
        .refusal($message)
    }

    /// A row: the song, its author under it; while Välj is on, picked by a tap.
    @ViewBuilder private func songRow(_ s: SongRow) -> some View {
        let label = VStack(alignment: .leading, spacing: 2) {
            Text(s.name)
            if let a = s.author, !a.isEmpty { Text(a).font(.caption).foregroundStyle(.secondary) }
        }
        LibraryRow(picking: $picking, id: s.id, label: label) { label in
            NavigationLink(value: s.id) { label }
                .contextMenu { ActionButtons(actions: lib?.row ?? []) { act($0, s) } }
                .swipeActions { ActionButtons(actions: (lib?.row ?? []).filter(\.destructive)) { act($0, s) } }
        }
    }

    /// What the list can do, the core's (`libraryPageView`).
    private var lib: LibraryPage? { model.libraryPage("songs") }

    /// A row's action by the core's id.
    private func act(_ id: String, _ s: SongRow) {
        switch id {
        case "rename": rename(s)
        case "delete": trashing = s
        default: break
        }
    }

    /// The trash's question, with the presentations that show the song, as the web's song page asks it.
    private func trashText(_ s: SongRow) -> String {
        struct P: Decodable { let name: String }
        let used = model.view("songPresentationsView", ["songId": s.id], as: [P].self) ?? []
        let ask = t("song.trashConfirm", ["name": s.name])
        return used.isEmpty ? ask : ask + " " + t("song.usedIn", ["names": used.map(\.name).joined(separator: ", ")])
    }

    /// Ny sång: named afresh, with its first part (Vers 1, empty), and opened.
    private func create(_ all: [SongRow]) {
        let id = UUID().uuidString.lowercased()
        let name = model.freshName(t("songs.new"), taken: all.map(\.name))
        if let e = change(model, "createSong", ["id": id, "name": name]) { return message = e }
        // Its part refused: said here, not opened (opening would push past the alert and leave a song with no part).
        if let e = change(model, "addSongPart", ["id": UUID().uuidString.lowercased(), "songId": id, "labelText": "Verse 1", "content": ""]) { return message = e }
        opened = id
    }

    private func rename(_ s: SongRow) {
        prompt = TextPrompt(title: t("library.renameTitle"), label: t("song.name"), text: s.name, rule: FieldRule(required: true, max: 200)) { name in
            message = change(model, "updateSong", ["id": s.id, "name": name.trimmingCharacters(in: .whitespaces)])
        }
    }

    /// The files read (each at most 25 MB, a `.pro`), and the plan shown when any shares a name; else sent at once.
    private func read(_ urls: [URL], library: [SongRow]) {
        var read: [ImportedSong] = []
        var failed = 0
        for url in urls {
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            guard url.pathExtension.lowercased() == "pro", let data = try? Data(contentsOf: url), data.count <= 25 * 1024 * 1024,
                  let song = model.view("proPresenterSongView", ["data": data.base64EncodedString(), "fileName": url.lastPathComponent], as: ImportedSong.self)
            else { failed += 1; continue }
            read.append(song)
        }
        guard !read.isEmpty else { return message = t("songs.import.none") }
        let p = ImportPlan.make(read, library: library, model: model, failed: failed)
        if p.duplicates.isEmpty { message = send(p, []) } else { plan = p }
    }

    /// What is chosen sent in batches of 500, as the core takes them, and what came of it said.
    private func send(_ p: ImportPlan, _ choices: [String]) -> String {
        var songs: [[String: Any]] = []
        for (i, s) in p.songs.enumerated() {
            let d = p.duplicates.firstIndex { $0.index == i }
            let choice = d.map { choices.indices.contains($0) ? choices[$0] : p.duplicates[$0].choice }
            if choice == "skip" { continue }
            var song = s
            song["replaces"] = choice == "replace" ? (p.duplicates[d!].other.id.map { $0 as Any } ?? NSNull()) : NSNull()
            songs.append(song)
        }
        for start in stride(from: 0, to: songs.count, by: 500) {
            if let e = change(model, "importSongs", ["songs": Array(songs[start..<min(start + 500, songs.count)])]) { return e }
        }
        let count = { (c: String) in p.duplicates.enumerated().filter { (choices.indices.contains($0.offset) ? choices[$0.offset] : $0.element.choice) == c }.count }
        let (skipped, replaced) = (count("skip"), count("replace"))
        let parts: [(Int, String)] = [(p.songs.count - skipped - replaced, "new"), (replaced, "replaced"), (skipped, "skipped"), (p.failed, "failed")]
        let said = parts.filter { $0.0 > 0 }.map { t("songs.import.\($0.1).\($0.0 == 1 ? "one" : "many")", ["n": $0.0]) }
        return said.isEmpty ? t("songs.import.nothing") : said.joined(separator: ", ") + "."
    }
}

/// A `.pro` file as a song, as the core reads it.
struct ImportedSong: Decodable {
    struct Part: Decodable { let labelText: String?, content: String }
    struct Arrangement: Decodable { let name: String?, partIndexes: [Int] }
    let name: String, author: String?, publisher: String?, ccli: String?, parts: [Part], arrangements: [Arrangement]
}

/// An import: the songs as `importSongs` takes them, and those that share a name, each with the core's choices.
struct ImportPlan: Identifiable {
    struct Duplicate: Decodable { struct Other: Decodable { let id: String?, text: String }; let index: Int, other: Other, same: Bool, choices: [String], choice: String }
    let id = UUID()
    let songs: [[String: Any]], names: [String], texts: [String], duplicates: [Duplicate], failed: Int

    @MainActor static func make(_ read: [ImportedSong], library: [SongRow], model: Model, failed: Int) -> ImportPlan {
        let text = { (parts: [String]) in parts.joined(separator: "\n\n") }
        let at = model.view("songNamesakesView", ["names": read.map(\.name), "library": library.map(\.name)], as: [Int].self) ?? []
        let namesakes = at.map { library[$0] }
        let parts = model.view("songPartsView", ["songIds": namesakes.map(\.id)], as: [SongPartRow].self) ?? []
        let lib = namesakes.map { s in ["id": s.id, "name": s.name, "text": text(parts.filter { $0.songId == s.id }.map(\.content))] }
        let texts = read.map { text($0.parts.map(\.content)) }
        let found = model.view("songImportDuplicatesView", ["songs": read.enumerated().map { ["name": $0.element.name, "text": texts[$0.offset]] }, "library": lib], as: [Duplicate].self) ?? []
        let songs: [[String: Any]] = read.map { s in
            let ids = s.parts.map { _ in UUID().uuidString.lowercased() }
            return ["id": UUID().uuidString.lowercased(), "name": s.name, "author": s.author ?? NSNull(), "publisher": s.publisher ?? NSNull(), "ccli": s.ccli ?? NSNull(),
                    "parts": s.parts.enumerated().map { ["id": ids[$0.offset], "labelText": $0.element.labelText ?? NSNull(), "content": $0.element.content] as [String: Any] },
                    "arrangements": s.arrangements.map { ["id": UUID().uuidString.lowercased(), "name": $0.name ?? NSNull(), "partIds": $0.partIndexes.map { ids[$0] }] as [String: Any] }]
        }
        return ImportPlan(songs: songs, names: read.map(\.name), texts: texts, duplicates: found, failed: failed)
    }
}

/// The songs that share a name with one in the library or earlier in the file: each Hoppa över, Ersätt (a library
/// song only) or Behåll båda, starting as the core says (a same text skipped, another kept).
struct ImportDuplicatesSheet: View {
    let plan: ImportPlan
    let done: ([String]) -> Void
    @State private var choices: [String] = []

    var body: some View {
        Form {
            Text(t("songs.import.dupText", ["n": plan.duplicates.count, "m": plan.songs.count]))
            ForEach(Array(plan.duplicates.enumerated()), id: \.offset) { i, d in
                Section {
                    Picker(plan.names[d.index], selection: Binding(get: { choices.indices.contains(i) ? choices[i] : d.choice }, set: { choices[i] = $0 })) {
                        ForEach(d.choices, id: \.self) { c in Text(t("songs.import.choice.\(c)")).tag(c) }
                    }
                    Text(t(d.same ? "songs.import.same" : "songs.import.different")).font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup(t("songs.import.showText")) { Text(plan.texts[d.index]).font(.callout) }
                }
            }
        }
        .formStyle(.grouped)
        .onAppear { choices = plan.duplicates.map(\.choice) }
        .sheetBar(t("songs.import.dupTitle"), confirm: t("songs.import.import")) { done(choices); return true }
        .sheetSize(460, 420)
    }
}
