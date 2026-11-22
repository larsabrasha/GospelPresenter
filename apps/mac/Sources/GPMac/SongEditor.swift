// A song's page (the web's SongEditor.tsx, SongArrangements.tsx, SongArrangement.tsx, SongHistory.tsx and
// song-materials/SongMaterials.tsx), as `songPageView` gives it: its name and credits, its parts (a label, the text,
// moved and removed), its arrangements, its history to restore from, its notes and links, and the trash. Every
// field is saved as it is typed by the core's rules (AutoSaveField.swift, `autoSaveStepView`).
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

struct SongPage: Decodable {
    struct Song: Decodable { let id: String, name: String, author: String?, publisher: String?, year: Int?, ccli: String?, deletedAt: Double? }
    struct Arrangement: Decodable, Identifiable, Hashable { let id: String, name: String?, partIds: String; var ids: [String] { (try? JSONDecoder().decode([String].self, from: Data(partIds.utf8))) ?? [] } }
    let song: Song?, parts: [SongPartRow], arrangements: [Arrangement], labels: [LabelRow]
}

struct SongEditorPage: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var trashing = false
    @State private var removingPart: SongPartRow?
    @State private var message: String?

    private var page: SongPage? { model.view("songPageView", ["id": id], as: SongPage.self) }

    var body: some View {
        let page = page
        Form {
            if let song = page?.song {
                // Each saved as it is typed, by the core's rules (`autoSaveStepView`): a blank name and a year that is
                // not one are not written.
                Section {
                    field("name", t("song.name"), song.name, .required, 200)
                    field("author", t("song.author"), song.author ?? "", .text, 200)
                    field("publisher", t("song.publisher"), song.publisher ?? "", .text, 200)
                    field("year", t("song.year"), song.year.map(String.init) ?? "", .year, 4)
                    field("ccli", t("song.ccli"), song.ccli ?? "", .text, 20)
                }
                let parts = page?.parts ?? []
                ForEach(Array(parts.enumerated()), id: \.element.id) { i, part in
                    Section { PartEditor(part: part, labels: page?.labels ?? [], first: i == 0, last: i == parts.count - 1, message: $message, removing: $removingPart) }
                }
                Section {
                    Button(t("song.addPart"), systemImage: "plus") {
                        message = change(model, "addSongPart", ["id": UUID().uuidString.lowercased(), "songId": id, "labelText": NSNull(), "content": ""])
                    }.disabled(parts.count >= model.limit("partsPerSong"))
                }
                Section {
                    NavigationLink(t("song.arrangements")) { ArrangementsPage(songId: id) }
                    NavigationLink(t("material.title")) { MaterialsPage(songId: id) }
                    NavigationLink(t("song.history")) { HistoryPage(songId: id) }
                }
                if song.deletedAt == nil { Section { Button(t("song.trash"), role: .destructive) { trashing = true } } }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(page?.song?.name ?? "")
        .confirmationDialog(t("song.trash"), isPresented: $trashing) {
            Button(t("song.trash"), role: .destructive) { if let e = change(model, "trashSong", ["id": id, "at": nowMs()]) { message = e } else { dismiss() } }
        } message: {
            // With the presentations that show it, as the web's song page asks.
            let used = (model.view("songPresentationsView", ["songId": id], as: [PresentationRow].self) ?? []).map(\.name)
            Text([t("song.trashConfirm", ["name": page?.song?.name ?? ""]), used.isEmpty ? "" : t("song.usedIn", ["names": used.joined(separator: ", ")])].filter { !$0.isEmpty }.joined(separator: " "))
        }
        .confirmationDialog(t("song.removePart"), isPresented: Binding(get: { removingPart != nil }, set: { if !$0 { removingPart = nil } }), presenting: removingPart) { p in
            Button(t("song.removePart"), role: .destructive) { message = change(model, "removeSongPart", ["id": p.id]) }
        } message: { _ in Text(t("song.removePartConfirm")) }
        .refusal($message)
    }

    /// A field of the song's, saved as it is typed.
    private func field(_ name: String, _ label: String, _ stored: String, _ kind: AutoSaveKind, _ max: Int) -> some View {
        AutoSaveField(command: "updateSong", args: ["id": id], field: name, kind: kind, max: max, label: label, stored: stored) { message = $0 }
    }
}

/// A part: its label (none, or one of the organisation's), its text saved as it is typed, and its ⋯ (move, remove).
struct PartEditor: View {
    @Environment(Model.self) private var model
    let part: SongPartRow, labels: [LabelRow], first: Bool, last: Bool
    @Binding var message: String?
    @Binding var removing: SongPartRow?

    var body: some View {
        HStack {
            Picker(t("song.label"), selection: Binding(get: { part.labelId ?? "" }, set: { id in
                let label = labels.first { $0.id == id }?.text
                message = change(model, "updateSongPart", ["id": part.id, "labelText": label.map { $0 as Any } ?? NSNull()])
            })) {
                Text(t("song.noLabel")).tag("")
                ForEach(labels) { l in Text(l.text).tag(l.id) }
            }
            .labelsHidden().fixedSize()
            Spacer()
            Menu {
                Button(t("common.moveUp"), systemImage: "arrow.up") { move(-1) }.disabled(first)
                Button(t("common.moveDown"), systemImage: "arrow.down") { move(1) }.disabled(last)
                Button(t("song.removePart"), systemImage: "trash", role: .destructive) { removing = part }
            } label: { Image(systemName: "ellipsis.circle") }.menuIndicator(.hidden).fixedSize()
        }
        // Saved as it is typed; another device's change meanwhile asks first (D18, the core's `autoSaveStepView`).
        AutoSaveField(command: "updateSongPart", args: ["id": part.id], field: "content", max: 5000, warnOnClash: true, multiline: true,
                      label: t("song.parts"), stored: part.content) { message = $0 }
    }

    private func move(_ by: Int) {
        let parts = model.view("songPageView", ["id": part.songId], as: SongPage.self)?.parts ?? []
        guard let at = parts.firstIndex(where: { $0.id == part.id }) else { return }
        message = change(model, "moveSongPart", ["id": part.id, "toIndex": at + by])
    }
}

extension Model {
    /// A limit of the organisation's data, the core's (`rulesView`'s limits).
    func limit(_ name: String) -> Int {
        struct Rules: Decodable { let limits: [String: Int] }
        return view("rulesView", as: Rules.self)?.limits[name] ?? .max
    }
}

/// A part's line in an order: its label, else "Del n" (the web's `orderLine`).
private func partName(_ id: String, _ page: SongPage) -> String {
    guard let i = page.parts.firstIndex(where: { $0.id == id }) else { return "?" }
    let label = page.labels.first { $0.id == page.parts[i].labelId }?.text
    return label ?? "\(i + 1)"
}

struct ArrangementsPage: View {
    @Environment(Model.self) private var model
    let songId: String
    @State private var message: String?

    var body: some View {
        let page = model.view("songPageView", ["id": songId], as: SongPage.self)
        Form {
            if let page {
                Section { LabeledContent(t("song.original"), value: page.parts.map { partName($0.id, page) }.joined(separator: " · ")) }
                Section {
                    ForEach(Array(page.arrangements.enumerated()), id: \.element.id) { i, a in
                        NavigationLink {
                            ArrangementPage(songId: songId, id: a.id)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(a.name ?? (page.arrangements.count == 1 ? t("song.arrangement") : "\(t("song.arrangement")) \(i + 1)"))
                                Text(a.ids.map { partName($0, page) }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if page.arrangements.count < model.limit("arrangementsPerSong") {
                        Button(t("song.createArrangement"), systemImage: "plus") {
                            message = change(model, "createArrangement", ["id": UUID().uuidString.lowercased(), "songId": songId, "partIds": page.parts.map(\.id)])
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(t("song.arrangements"))
        .refusal($message)
    }
}

struct ArrangementPage: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let songId: String, id: String
    @State private var name = ""
    @FocusState private var naming: Bool
    @State private var removing = false
    @State private var message: String?

    var body: some View {
        let page = model.view("songPageView", ["id": songId], as: SongPage.self)
        let a = page?.arrangements.first { $0.id == id }
        Form {
            if let page, let a {
                TextField(t("song.name"), text: $name).savedWhenLeft($naming, value: name) {
                    let v = name.trimmingCharacters(in: .whitespaces)
                    if v != (a.name ?? "") { message = change(model, "updateArrangement", ["id": id, "name": v]) }
                }
                Section(t("song.arrangementParts")) {
                    ForEach(Array(a.ids.enumerated()), id: \.offset) { i, part in
                        HStack {
                            Text(partName(part, page))
                            Spacer()
                            Button { message = change(model, "removeArrangementPart", ["id": id, "index": i, "partId": part]) } label: { Image(systemName: "minus.circle.fill").foregroundStyle(.red) }.buttonStyle(.borderless)
                        }
                    }
                    .onMove { from, to in
                        guard let i = from.first else { return }
                        let by = (to > i ? to - 1 : to) - i
                        if by != 0 { message = change(model, "moveArrangementPart", ["id": id, "index": i, "partId": a.ids[i], "by": by]) }
                    }
                }
                Section(t("song.songParts")) {
                    ForEach(page.parts) { p in
                        Button { message = change(model, "appendArrangementPart", ["id": id, "partId": p.id]) } label: { Label(partName(p.id, page), systemImage: "plus.circle.fill") }
                    }
                }
                Section { Button(t("song.removeArrangement"), role: .destructive) { removing = true } }
            }
        }
        .formStyle(.grouped)
        .onAppear { name = a?.name ?? "" }
        .confirmationDialog(t("song.removeArrangement"), isPresented: $removing) {
            Button(t("song.removeArrangement"), role: .destructive) { if let e = change(model, "removeArrangement", ["id": id]) { message = e } else { dismiss() } }
        } message: { Text(t("song.removeArrangementConfirm")) }
        .refusal($message)
    }
}

struct HistoryPage: View {
    @Environment(Model.self) private var model
    let songId: String
    @State private var restoring: Version?
    @State private var viewing: Version?
    /// The version Återställ version was pressed for, asked about once its sheet has closed.
    @State private var chosen: Version?
    @State private var message: String?
    struct Version: Decodable, Identifiable, Hashable { let id: String, at: Double, name: String?, author: String?, slides: [JSONValue] }
    private struct Day: Decodable { let day: String, versions: [Version] }
    private struct History: Decodable { let days: [Day], theme: JSONValue? }

    var body: some View {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date()), yesterday = cal.date(byAdding: .day, value: -1, to: today)!
        let history = model.view("songHistoryPageView", ["id": songId, "today": today.timeIntervalSince1970 * 1000, "yesterday": yesterday.timeIntervalSince1970 * 1000], as: History.self)
        // An older day's versions under one heading of its date, as the web's.
        let sections = Dictionary(grouping: history?.days.flatMap { d in d.versions.map { (heading(d.day, $0.at), $0) } } ?? [], by: \.0)
            .map { ($0.key, $0.value.map(\.1)) }.sorted { ($0.1.first?.at ?? 0) > ($1.1.first?.at ?? 0) }
        List {
            ForEach(sections, id: \.0) { section in
                Section(section.0) {
                    ForEach(section.1) { v in
                        Button { viewing = v } label: {
                            LabeledContent(v.name ?? "", value: Date(timeIntervalSince1970: v.at / 1000).formatted(.dateTime.locale(Texts.locale).hour().minute()))
                        }
                    }
                }
            }
        }
        .overlay { if history?.days.isEmpty == true { ContentUnavailableView(t("history.empty"), systemImage: "clock") } }
        .navigationTitle(t("song.history"))
        // The confirm once the sheet has closed: asked while it closes, iOS presents nothing.
        .sheet(item: $viewing, onDismiss: { restoring = chosen; chosen = nil }) { v in
            // The version as it was, its parts as slides, with Återställ version.
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(v.name ?? "").font(.title3.weight(.semibold))
                    if let a = v.author { Text(a).foregroundStyle(.secondary) }
                    ForEach(Array(v.slides.enumerated()), id: \.offset) { _, slide in
                        LiveSlide(tile: TileRequest(slide: slide, theme: history?.theme, overlay: nil, label: true)).clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    Button(t("history.restore")) { chosen = v; viewing = nil }.role(.destructive)
                }
                .padding()
            }
            .sheetBar(t("history.preview"), confirm: t("common.close")) { true }
            .sheetSize(520, 520)
        }
        .confirmationDialog(t("history.restore"), isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } }), presenting: restoring) { v in
            Button(t("history.restore")) { message = change(model, "restoreSongVersion", ["songId": songId, "versionId": v.id]) }
        } message: { v in Text(t("history.restoreConfirm", ["time": Date(timeIntervalSince1970: v.at / 1000).formatted(.dateTime.locale(Texts.locale).day().month(.abbreviated).year().hour().minute())])) }
        .refusal($message)
    }

    /// A day's heading: Idag, Igår, else its date.
    private func heading(_ day: String, _ at: Double) -> String {
        day == "today" ? t("history.todayHeading") : day == "yesterday" ? t("history.yesterdayHeading")
            : Date(timeIntervalSince1970: at / 1000).formatted(.dateTime.locale(Texts.locale).day().month(.abbreviated).year())
    }
}

private extension Button {
    func role(_ r: ButtonRole) -> some View { self.foregroundStyle(r == .destructive ? .red : .primary) }
}

struct MaterialsPage: View {
    @Environment(Model.self) private var model
    let songId: String
    @State private var adding = false
    @State private var uploading = false
    @State private var prompt: TextPrompt?
    @State private var removing: Material?
    @State private var viewing: URL?
    @State private var message: String?

    /// The file under its title and type's extension, as Quick Look names and shares it.
    static func named(_ file: URL, _ m: Material) -> URL {
        let ext = m.contentType == "application/pdf" ? "pdf" : (UTType(mimeType: m.contentType ?? "")?.preferredFilenameExtension ?? "m4a")
        let copy = FileManager.default.temporaryDirectory.appending(path: "\(m.title.fileSafe).\(ext)")
        try? FileManager.default.removeItem(at: copy)
        return (try? FileManager.default.copyItem(at: file, to: copy)) != nil ? copy : file
    }
    struct Material: Decodable, Identifiable, Hashable { let id: String, kind: String, title: String, url: String?, hash: String?, contentType: String? }

    var body: some View {
        let materials = model.view("songMaterialsView", ["songIds": [songId]], as: [Material].self) ?? []
        List {
            ForEach(materials) { m in
                Label(m.title, systemImage: m.kind == "link" ? "link" : m.contentType == "application/pdf" ? "doc.richtext" : "waveform")
                    .contextMenu {
                        if let u = m.url.flatMap(URL.init(string:)) { Link(t("material.openInBrowser"), destination: u) }
                        // A PDF or a recording looked at here, as the web's viewer, and shared from there.
                        if let hash = m.hash {
                            Button(t("material.title"), systemImage: "eye") { Task { viewing = await MediaFiles.file(hash, store: model.store).map { Self.named($0, m) } } }
                        }
                        Button(t("library.rename"), systemImage: "pencil") {
                            prompt = TextPrompt(title: t("library.renameTitle"), label: t("displays.name"), text: m.title, rule: FieldRule(required: true, max: 200)) { title in
                                message = change(model, "renameSongMaterial", ["id": m.id, "title": title.trimmingCharacters(in: .whitespaces)])
                            }
                        }
                        Button(t("common.delete"), systemImage: "trash", role: .destructive) { removing = m }
                    }
            }
        }
        .overlay { if materials.isEmpty { ContentUnavailableView(t("material.empty"), systemImage: "paperclip") } }
        .navigationTitle(t("material.title"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(t("material.addLink"), systemImage: "link") { addLink() }
                    Button(t("material.uploadFile"), systemImage: "doc") { uploading = true }
                } label: { Label(t("material.addLink"), systemImage: "plus") }
            }
        }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [.pdf, .audio]) { result in
            guard case let .success(url) = result else { return }
            upload(url)
        }
        .confirmationDialog(t("common.delete"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { m in
            Button(t("common.delete"), role: .destructive) { message = change(model, "removeSongMaterial", ["id": m.id]) }
        } message: { m in Text(t("material.removeConfirm", ["title": m.title])) }
        .quickLookPreview($viewing)
        .textPrompt($prompt)
        .refusal($message)
    }

    private func addLink() {
        prompt = TextPrompt(title: t("material.addLink"), label: "URL", text: "https://", rule: FieldRule(required: true, max: 2000)) { text in
            guard let url = URL(string: text.trimmingCharacters(in: .whitespaces)), url.scheme?.hasPrefix("http") == true, let host = url.host() else { return message = t("material.badUrl") }
            message = change(model, "addSongLink", ["id": UUID().uuidString.lowercased(), "songId": songId, "title": host, "url": url.absoluteString, "createdAt": nowMs()])
        }
    }

    /// A PDF or a recording kept in the media folder by its hash and recorded, then `addSongFile`; it goes up before.
    private func upload(_ url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), data.count <= 20 * 1024 * 1024 else { return message = t("material.failedOther", ["name": url.lastPathComponent]) }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/pdf"
        guard let hash = keepFile(data, type: type, model: model) else { return }
        message = change(model, "addSongFile", ["id": UUID().uuidString.lowercased(), "songId": songId, "title": url.deletingPathExtension().lastPathComponent,
                                                "contentType": type, "hash": hash, "size": data.count, "createdAt": nowMs()])
    }
}
