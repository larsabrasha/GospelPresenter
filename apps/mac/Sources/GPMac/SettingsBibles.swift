// Biblar (the web's Bibles.tsx and BibleDetail.tsx) and Bildspel (custom-slides/CustomSlides.tsx): the translations,
// to import from a zip (read by the core, `bibleImportTextView`), rename, keep offline and delete; the slideshows, to
// make, rename and put in the trash. Each change a mutation through the core.
import Shell
import SwiftUI
import UniformTypeIdentifiers

struct BibleRow: Decodable, Identifiable, Hashable {
    let id: String, name: String, abbreviation: String, verseCount: Int, contentHash: String, stored: Bool, kept: Bool
}

struct BiblesPage: View {
    @Environment(Model.self) private var model
    @State private var query = ""
    @State private var importing = false
    @State private var busy = false
    @State private var deleting: BibleRow?
    @State private var message: String?
    @State private var picking = Picking()
    @State private var deletingMany = false
    /// The Bible opened by a double click on a Mac.
    @State private var opened: String?
    /// What the list can do, the core's (`libraryPageView`).
    private var lib: LibraryPage? { model.libraryPage("bibles") }

    var body: some View {
        let all = model.view("biblesView", ["locale": Texts.language], as: [BibleRow].self) ?? []
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let bibles = q.isEmpty ? all : all.filter { $0.name.lowercased().contains(q) || $0.abbreviation.lowercased().contains(q) }
        List(selection: listSelection($picking)) {
            if busy { Text(t("bibles.processing")).foregroundStyle(.secondary) }
            Section {
                ForEach(bibles) { b in
                    let label = VStack(alignment: .leading, spacing: 2) {
                        Text(b.name)
                        Text(t("bibles.row", ["abbreviation": b.abbreviation, "n": b.verseCount])).font(.caption).foregroundStyle(.secondary)
                    }
                    LibraryRow(picking: $picking, id: b.id, label: label) { label in
                        NavigationLink { BibleDetailPage(id: b.id) } label: { label }
                            .contextMenu { ActionButtons(actions: lib?.row ?? []) { _ in deleting = b } }
                            .swipeActions { ActionButtons(actions: (lib?.row ?? []).filter(\.destructive)) { _ in deleting = b } }
                    }
                }
            } footer: { Text(t("bibles.importText")) }
        }
        .libraryPicking(picking, open: { opened = $0 }, remove: { deletingMany = true }) { ids in
            if ids.count == 1, let id = ids.first { Button(t("palette.open"), systemImage: "arrow.up.forward.square") { opened = id } }
            ActionButtons(actions: lib?.picked ?? []) { _ in picking.ids = ids; deletingMany = true }
        }
        .navigationDestination(item: $opened) { id in BibleDetailPage(id: id) }
        .overlay { if all.isEmpty { ContentUnavailableView(t("bibles.empty"), systemImage: "book", description: Text(t("bibles.emptyText"))) } }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .floatingAdd(lib, shown: !picking.on) { importing = true }
        .toolbar {
            PickingToolbar(picking: $picking, shown: lib?.pick ?? false) { ActionButtons(actions: lib?.picked ?? []) { _ in deletingMany = true } }
        }
        .confirmationDialog(t("bibles.delete"), isPresented: $deletingMany) {
            Button(t("bibles.delete"), role: .destructive) {
                for id in picking.ids { message = change(model, "deleteBible", ["id": id]) ?? message }
                picking.end()
            }
        } message: { Text(t("bibles.deleteMany", ["n": picking.ids.count])) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.zip]) { result in
            guard case let .success(url) = result else { return }
            importZip(url)
        }
        .confirmationDialog(t("bibles.delete"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { b in
            Button(t("bibles.delete"), role: .destructive) { message = change(model, "deleteBible", ["id": b.id]) }
        } message: { b in Text(t("bibles.deleteConfirm", ["name": b.name])) }
        .refusal($message)
    }

    private struct Imported: Decodable { let name: String, abbreviation: String, language: String?, verses: Int, id: String, hash: String, json: String }

    /// The zip read by the core, its text kept here (marked kept, so it stays) and `importBible` queued; the text goes
    /// up before the import is pushed (SyncClient.uploadBeforePush).
    private func importZip(_ url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return message = t("bibles.error.not-zip") }
        busy = true
        defer { busy = false }
        let replaced = (model.view("biblesView", ["locale": Texts.language], as: [BibleRow].self) ?? [])
        switch model.app.call("bibleImportTextView", ["data": data.base64EncodedString()], as: Imported.self) {
        case let .refused(code): message = t("bibles.error.\(code)")
        case let .ok(b):
            guard case let .synced(client) = model.store else { return message = hostRefusal("no-server") }
            guard client.keepImported(b.id, hash: b.hash, json: b.json) else { return message = t("bibles.error.no-verses") }
            var args: [String: Any] = ["name": b.name, "abbreviation": b.abbreviation, "contentHash": b.hash]
            // Always given, null when the Bible names none, as the web sends it (importBible requires the key).
            args["language"] = b.language ?? NSNull()
            if let e = change(model, "importBible", args) { return message = e }
            message = t(replaced.contains { $0.id == b.id } ? "bibles.updated" : "bibles.imported", ["name": b.name, "n": b.verses])
        }
    }
}

struct BibleDetailPage: View {
    @Environment(Model.self) private var model
    let id: String
    @State private var name = ""
    @FocusState private var naming: Bool
    @State private var busy = false
    @State private var deleting = false
    @State private var message: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let bible = (model.view("biblesView", ["locale": Texts.language], as: [BibleRow].self) ?? []).first { $0.id == id }
        Form {
            if let bible {
                TextField(t("song.name"), text: $name).limited($name, to: 200)
                    .savedWhenLeft($naming, value: name) {
                        let v = name.trimmingCharacters(in: .whitespaces)
                        if !v.isEmpty, v != bible.name { message = change(model, "renameBible", ["id": id, "name": v]) }
                    }
                LabeledContent(t("bibles.abbreviation"), value: bible.abbreviation)
                LabeledContent(t("bibles.verses"), value: "\(bible.verseCount)")
                Toggle(t("bibles.offline"), isOn: Binding(get: { bible.kept && bible.stored }, set: { on in keep(on) })).disabled(busy || model.session == nil)
                Button(t("bibles.delete"), role: .destructive) { deleting = true }
            } else {
                Text(t("bibles.notFound")).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear { name = bible?.name ?? "" }
        .confirmationDialog(t("bibles.delete"), isPresented: $deleting) {
            Button(t("bibles.delete"), role: .destructive) { if let e = change(model, "deleteBible", ["id": id]) { message = e } else { dismiss() } }
        } message: { Text(t("bibles.deleteConfirm", ["name": bible?.name ?? ""])) }
        .refusal($message)
    }

    /// Kept offline: the text fetched now and kept, or dropped (the web's keepBible); said when it could not come.
    private func keep(_ on: Bool) {
        guard case let .synced(client) = model.store else { return }
        busy = true
        Task {
            let kept = await client.keepBible(id, on)
            busy = false
            model.app.changed()
            message = on ? (kept ? t("bibles.offlineDownloaded") : t("bibles.offlineFailed")) : t("bibles.offlineRemoved")
        }
    }
}

// MARK: Bildspel

struct CustomSlideRow: Decodable, Identifiable, Hashable {
    let id: String, name: String, updatedAt: Double, pages: JSONValue?
    /// Whether a page is a deck's (a PDF's or a PowerPoint's): Ersätt med ny fil is offered only then, as the web's.
    var fromDeck: Bool { if case let .array(p)? = pages { p.contains { $0["backgroundPage"] != nil && $0["backgroundPage"] != .null } } else { false } }
    var firstPage: JSONValue? { if case let .array(p)? = pages { p.first } else { nil } }
    var pageCount: Int { if case let .array(p)? = pages { p.count } else { 0 } }
}

/// A page drawn small as the outputs draw it (the core's layout and the painter), in the organisation's default theme:
/// a slideshow's first page in its list, an overlay's page in its.
struct PagePreview: View {
    @Environment(Model.self) private var model
    let page: JSONValue?

    var body: some View {
        if let page {
            LiveSlide(tile: TileRequest(slide: model.view("editorSlideView", ["page": page.any], as: JSONValue.self), theme: model.view("themeView", ["id": NSNull()], as: JSONValue.self),
                                        overlay: nil, label: false, media: model.app.mediaGeneration))
                .allowsHitTesting(false)
        } else {
            Color.black
        }
    }
}

struct CustomSlidesPage: View {
    @Environment(Model.self) private var model
    @State private var prompt: TextPrompt?
    @State private var trashing: CustomSlideRow?
    @State private var message: String?
    @State private var query = ""
    @State private var opened: String?
    /// A file to import: a new slideshow (nil), or new pages for this one (Ersätt med ny fil).
    @State private var importing: String??
    @State private var replacing: CustomSlideRow?
    @State private var busy = false

    @State private var sort: String?
    @State private var picking = Picking()
    @State private var trashingMany = false
    private struct Ordered: Decodable { struct Sort: Decodable, Hashable { let id: String, text: String }; let rows: [CustomSlideRow], sorts: [Sort], sort: String }

    var body: some View {
        let all = model.view("customSlidesView", as: [CustomSlideRow].self) ?? []
        let args: [String: Any] = ["kind": "customSlides", "query": query, "locale": Texts.language, "sort": sort ?? ""]
        let ordered = model.view("libraryOrderView", args, as: Ordered.self)
        let slides = ordered?.rows ?? []
        List(selection: listSelection($picking)) {
            if busy { Text(t("slides.importing")).foregroundStyle(.secondary) }
            ForEach(slides) { s in
                let label = HStack(spacing: 12) {
                    PagePreview(page: s.firstPage).frame(width: 96, height: 54).clipShape(RoundedRectangle(cornerRadius: 4))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.name)
                        Text(t(s.pageCount == 1 ? "customSlides.pagesOne" : "customSlides.pages", ["n": s.pageCount])).font(.caption).foregroundStyle(.secondary)
                    }
                }
                LibraryRow(picking: $picking, id: s.id, label: label) { label in
                    NavigationLink(value: s.id) { label }
                        .contextMenu { menu(s) }
                        .swipeActions { ActionButtons(actions: (lib?.row ?? []).filter(\.destructive)) { act($0, s) } }
                }
            }
        }
        .libraryPicking(picking, open: { opened = $0 }, remove: { trashingMany = true }) { ids in
            if ids.count == 1, let s = slides.first(where: { ids.contains($0.id) }) {
                Button(t("palette.open"), systemImage: "arrow.up.forward.square") { opened = s.id }
                menu(s)
            } else {
                ActionButtons(actions: lib?.picked ?? []) { _ in picking.ids = ids; trashingMany = true }
            }
        }
        .navigationDestination(for: String.self) { id in SlideEditorPage(target: .slideshow(id)) }
        .navigationDestination(item: $opened) { id in SlideEditorPage(target: .slideshow(id)) }
        .overlay { if all.isEmpty { ContentUnavailableView(t("customSlides.empty"), systemImage: "play.rectangle", description: Text(t("customSlides.emptyText"))) } }
        .floatingAdd(lib, shown: !picking.on, add: { create(all) }, extra: { importing = .some(nil) })
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .toolbar {
            if !picking.on {
                ToolbarItem(placement: .primaryAction) {
                    SortMenu(sorts: (ordered?.sorts ?? []).map { ($0.id, $0.text) }, selection: Binding(get: { ordered?.sort ?? "" }, set: { sort = $0 }))
                }
            }
            PickingToolbar(picking: $picking, shown: lib?.pick ?? false) { ActionButtons(actions: lib?.picked ?? []) { _ in trashingMany = true } }
        }
        .confirmationDialog(t("common.delete"), isPresented: $trashingMany) {
            Button(t("common.delete"), role: .destructive) {
                for id in picking.ids { message = change(model, "trashCustomSlide", ["id": id, "at": nowMs()]) ?? message }
                picking.end()
            }
        } message: { Text(t("library.trashMany", ["n": picking.ids.count])) }
        .fileImporter(isPresented: Binding(get: { importing != nil }, set: { if !$0 { importing = nil } }), allowedContentTypes: [.pdf, UTType(filenameExtension: "pptx") ?? .data, UTType(filenameExtension: "ppt") ?? .data]) { result in
            let into = importing ?? nil
            guard case let .success(url) = result else { return }
            Task { await importDeck(url, into: into) }
        }
        .confirmationDialog(t("slideDecks.replace"), isPresented: Binding(get: { replacing != nil }, set: { if !$0 { replacing = nil } }), presenting: replacing) { s in
            Button(t("slideDecks.replaceConfirm")) { importing = .some(s.id) }
        } message: { s in Text(t("slideDecks.replaceAsk", ["name": s.name])) }
        .textPrompt($prompt)
        .confirmationDialog(t("common.delete"), isPresented: Binding(get: { trashing != nil }, set: { if !$0 { trashing = nil } }), presenting: trashing) { s in
            Button(t("common.delete"), role: .destructive) { message = change(model, "trashCustomSlide", ["id": s.id, "at": nowMs()]) }
        } message: { s in Text(t("images.trashConfirm", ["name": s.name])) }
        .refusal($message)
    }

    /// A new slideshow of one blank page (packages/core's `blankPage()`), named afresh and opened.
    private func create(_ all: [CustomSlideRow]) {
        let id = UUID().uuidString.lowercased()
        let name = model.freshName(t("customSlides.new"), taken: all.map(\.name))
        let blank: [String: Any] = ["background": NSNull(), "backgroundPicture": NSNull(), "backgroundPage": NSNull(), "elements": [] as [Any]]
        message = change(model, "createCustomSlide", ["id": id, "name": name, "pages": [blank], "at": nowMs()])
        if message == nil { opened = id }
    }

    /// A PDF or a PowerPoint deck as a new slideshow named by its file, or as new pages for `into`.
    private func importDeck(_ url: URL, into: String?) async {
        busy = true
        defer { busy = false }
        switch await DeckImport.pages(url, model: model) {
        case let .failure(r): message = DeckImport.text(r.problem)
        case let .success((pages, charts)):
            let refused = into.map { change(model, "updateCustomSlide", ["id": $0, "pages": pages, "at": nowMs()]) }
                ?? change(model, "createCustomSlide", ["id": UUID().uuidString.lowercased(), "name": url.lastPathComponent, "pages": pages, "at": nowMs()])
            // The chart notice after a replace too, with the words that it was replaced.
            let done = into == nil ? nil : t("slideDecks.replaced", ["name": url.lastPathComponent])
            let said = [done, charts ? t("slides.charts") : nil].compactMap { $0 }
            message = refused ?? (said.isEmpty ? nil : said.joined(separator: "\n"))
        }
    }

    /// What the list can do, the core's (`libraryPageView`).
    private var lib: LibraryPage? { model.libraryPage("customSlides") }

    /// A slideshow's menu, the core's: Ersätt for a deck's pages (what was laid on them goes with them), Byt namn,
    /// Radera.
    private func menu(_ s: CustomSlideRow) -> some View {
        ActionButtons(actions: lib?.row ?? [], has: { $0 == "fromDeck" && s.fromDeck }) { act($0, s) }
    }

    private func act(_ id: String, _ s: CustomSlideRow) {
        switch id {
        case "replace": replacing = s
        case "rename": rename(s)
        case "delete": trashing = s
        default: break
        }
    }

    private func rename(_ s: CustomSlideRow) {
        prompt = TextPrompt(title: t("library.renameTitle"), label: t("displays.name"), text: s.name, rule: FieldRule(required: true, max: 200)) { name in
            message = change(model, "updateCustomSlide", ["id": s.id, "name": name.trimmingCharacters(in: .whitespaces), "at": nowMs()])
        }
    }
}

extension AppState {
    /// A view of the core as the store's user, with its refusal: a page that says why (an import's zip).
    func call<T: Decodable>(_ name: String, _ args: [String: Any], as type: T.Type) -> HostResult<T> {
        let result: Result<String?, Refusal>
        switch store {
        case let .demo(core): result = core.call(name, args, caller: Caller(userId: "demo", role: role, now: nil))
        case let .synced(client): result = client.core.call(name, args, caller: Caller(userId: client.session.me.userId, role: client.session.me.role, now: nil))
        case nil: return .refused("no-server")
        }
        switch result {
        case let .failure(r): return .refused(r.code)
        case let .success(json):
            guard let json, let v = try? JSONDecoder().decode(T.self, from: Data(json.utf8)) else { return .refused("unreadable") }
            return .ok(v)
        }
    }
}
