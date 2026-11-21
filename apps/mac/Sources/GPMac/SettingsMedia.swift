// Bilder, Ljud and Videor (the web's Images.tsx, Audios.tsx, Videos.tsx and ui/Library.tsx): the library's files in the
// order chosen and filtered by the search as the core orders them (`libraryOrderView`), as a list or a grid, Välj to
// pick several to download or put in the trash, a file opened to look at or hear, renamed, a picture edited or put
// back as it was, and files imported: a picture fitted and encoded as the core says (`mediaImportView`), a sound as it
// is, a video in parts to the server (VideoImport.swift). Kept files are recorded so the change adding them may name
// them; the sync uploads them before that change is pushed (SyncClient.uploadBeforePush).
import CryptoKit
import Shell
import SwiftUI
import UniformTypeIdentifiers

enum MediaKind: String { case image, audio, video }

/// A file of a library as its view gives it.
struct MediaFile: Decodable, Identifiable, Hashable {
    let id: String, fileName: String, createdAt: Double, contentType: String?
    let thumbHash: String?, fullHash: String?, originalFullHash: String?, width: Double?, height: Double?
    let originalWidth: Double?, originalHeight: Double?, edit: String?
    let hash: String?, size: Double?, duration: Double?, stillHash: String?, codec: String?
}

private struct Ordered: Decodable { struct Sort: Decodable, Hashable { let id: String, text: String }; let rows: [MediaFile], sorts: [Sort], sort: String }

extension MediaKind {
    var library: String { ["image": "images", "audio": "audios", "video": "videos"][rawValue]! }
    var view: String { ["image": "imagesView", "audio": "audiosView", "video": "videosView"][rawValue]! }
    var title: String { ["image": "Image", "audio": "Audio", "video": "Video"][rawValue]! }
    var manage: String { "Manage\(title)s" }
    /// The web asks the same for every file (Library.tsx): the picture's words.
    var trashKey: String { "images.trashConfirm" }
    var importKey: String { ["image": "images.emptyImport", "audio": "audios.emptyImport", "video": "videos.emptyImport"][rawValue]! }
    var emptyKey: String { ["image": "images.empty", "audio": "audios.empty", "video": "presentation.noVideos"][rawValue]! }
    var symbol: String { ["image": "photo", "audio": "speaker.wave.2", "video": "video"][rawValue]! }
    var accepts: [UTType] { self == .image ? [.jpeg, .png, .webP, .gif] : self == .audio ? [.audio] : [.mpeg4Movie, .quickTimeMovie] }
}

struct MediaLibraryPage: View {
    @Environment(Model.self) private var model
    let kind: MediaKind
    @AppStorage("gp.library.grid") private var grid = true
    @State private var query = ""
    @State private var sort: String?
    @State private var selecting = false
    @State private var picked: Set<String> = []
    @State private var prompt: TextPrompt?
    @State private var trashing: [MediaFile] = []
    @State private var importing = false
    @State private var opened: MediaFile?
    @State private var editing: MediaFile?
    @State private var exporting: [FileURLDocument] = []
    @State private var busy: String?
    @State private var message: String?

    var body: some View {
        var args: [String: Any] = ["kind": kind.library, "query": query, "locale": Texts.language]
        if let sort { args["sort"] = sort }
        let ordered = model.view("libraryOrderView", args, as: Ordered.self)
        let files = ordered?.rows ?? []
        let manage = model.can(kind.manage)
        let gridded = grid && kind != .audio
        return Group {
            if gridded {
                ScrollView {
                    if let busy { Text(busy).foregroundStyle(.secondary).padding(.top) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                        ForEach(files) { f in tile(f, manage: manage) }
                    }
                    .padding()
                }
            } else {
                List {
                    if let busy { Text(busy).foregroundStyle(.secondary) }
                    ForEach(files) { f in
                        HStack {
                            if selecting { Image(systemName: picked.contains(f.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(Color.sky) }
                            row(f)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { tap(f) }
                        .contextMenu { if manage { menu(f) } }
                        .swipeActions { if manage { Button(t("common.delete"), role: .destructive) { trashing = [f] } } }
                    }
                }
            }
        }
        .overlay { if ordered?.rows.isEmpty == true, query.isEmpty { ContentUnavailableView(t(kind.emptyKey), systemImage: kind.symbol) } }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .toolbar { toolbar(ordered, files: files, manage: manage) }
        .fileImporter(isPresented: $importing, allowedContentTypes: kind.accepts, allowsMultipleSelection: true) { result in
            guard case let .success(urls) = result else { return }
            Task { await importFiles(urls) }
        }
        .fileExporter(isPresented: Binding(get: { !exporting.isEmpty }, set: { if !$0 { exporting = [] } }), documents: exporting, contentType: .data) { _ in exporting = [] }
        .textPrompt($prompt)
        .confirmationDialog(t("common.delete"), isPresented: Binding(get: { !trashing.isEmpty }, set: { if !$0 { trashing = [] } })) {
            Button(t("common.delete"), role: .destructive) {
                for f in trashing { message = change(model, "trash\(kind.title)", ["id": f.id, "at": nowMs()]) ?? message }
                selecting = false
                picked = []
            }
        } message: { Text(trashing.count == 1 ? t(kind.trashKey, ["name": trashing[0].fileName]) : t("library.trashMany", ["n": trashing.count])) }
        .sheet(item: $opened) { f in MediaPreview(kind: kind, file: f) }
        .sheet(item: $editing) { f in ImageEditorSheet(image: f) }
        .refusal($message)
    }

    @ToolbarContentBuilder private func toolbar(_ ordered: Ordered?, files: [MediaFile], manage: Bool) -> some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if selecting {
                Button(t("library.download"), systemImage: "square.and.arrow.down") { Task { await download(files.filter { picked.contains($0.id) }) } }.disabled(picked.isEmpty)
                if manage { Button(t("common.delete"), systemImage: "trash", role: .destructive) { trashing = files.filter { picked.contains($0.id) } }.disabled(picked.isEmpty) }
                Button(t("library.done")) { selecting = false; picked = [] }
            } else {
                Menu {
                    Picker(t("library.sortBy", ["order": ""]), selection: Binding(get: { ordered?.sort ?? "" }, set: { sort = $0 })) {
                        ForEach(ordered?.sorts ?? [], id: \.self) { s in Text(t(s.text)).tag(s.id) }
                    }
                    if kind != .audio {
                        Picker(t("library.layout"), selection: $grid) {
                            Label(t("library.asGrid"), systemImage: "square.grid.2x2").tag(true)
                            Label(t("library.asList"), systemImage: "list.bullet").tag(false)
                        }
                    }
                } label: { Label(t("library.layout"), systemImage: "arrow.up.arrow.down") }
                Button(t("library.select")) { selecting = true }
                if manage { Button(t(kind.importKey), systemImage: "plus") { importing = true } }
            }
        }
    }

    private func tap(_ f: MediaFile) {
        if selecting { if picked.contains(f.id) { picked.remove(f.id) } else { picked.insert(f.id) } } else { opened = f }
    }

    private func tile(_ f: MediaFile, manage: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            thumbnail(f).aspectRatio(16 / 9, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .topTrailing) {
                    if selecting { Image(systemName: picked.contains(f.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(.white, Color.sky).padding(6) }
                }
            Text(f.fileName).font(.caption).lineLimit(1)
            Text(detail(f)).font(.caption2).foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .onTapGesture { tap(f) }
        .contextMenu { if manage { menu(f) } }
    }

    private func row(_ f: MediaFile) -> some View {
        HStack(spacing: 12) {
            thumbnail(f).frame(width: 64, height: 36).clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 2) {
                Text(f.fileName).lineLimit(1)
                Text(detail(f)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func thumbnail(_ f: MediaFile) -> some View {
        let hash = f.thumbHash ?? f.stillHash
        if let hash, let image = platformImage(AppScheme.mediaDir.appending(path: hash)) {
            image.resizable().scaledToFill()
        } else {
            Image(systemName: kind.symbol).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.raised)
        }
    }

    private func detail(_ f: MediaFile) -> String {
        switch kind {
        case .image: return "\(Int(f.width ?? 0)) × \(Int(f.height ?? 0))"
        case .audio: return ByteCountFormatter.string(fromByteCount: Int64(f.size ?? 0), countStyle: .file)
        case .video:
            let d = Int(f.duration ?? 0)
            let codec = f.codec == "hevc" ? "HEVC" : "H.264"
            return "\(d / 60):\(String(format: "%02d", d % 60)) · " + ByteCountFormatter.string(fromByteCount: Int64(f.size ?? 0), countStyle: .file) + " · \(codec)"
        }
    }

    @ViewBuilder private func menu(_ f: MediaFile) -> some View {
        if kind == .image { Button(t("images.edit"), systemImage: "crop") { editing = f } }
        if kind == .image, f.originalFullHash != nil {
            Button(t("images.revert"), systemImage: "arrow.uturn.backward") { message = change(model, "revertImage", ["id": f.id]) }
        }
        Button(t("library.rename"), systemImage: "pencil") {
            prompt = TextPrompt(title: t("library.renameTitle"), label: t("library.fileName"), text: f.fileName, rule: FieldRule(required: true, max: 200)) { name in
                message = change(model, "rename\(kind.title)", ["id": f.id, "fileName": name.trimmingCharacters(in: .whitespaces)])
            }
        }
        Button(t("library.download"), systemImage: "square.and.arrow.down") { Task { await download([f]) } }
        Button(t("common.delete"), systemImage: "trash", role: .destructive) { trashing = [f] }
    }

    /// The files saved where the person chooses: a picture's or a sound's from this device (fetched first when it
    /// lacks them), a video's from the server; several at once each as its own file.
    private func download(_ files: [MediaFile]) async {
        busy = t("library.downloading", ["n": files.count])
        defer { busy = nil }
        var docs: [FileURLDocument] = []
        for f in files {
            guard let url = await MediaFiles.local(kind, f, model: model) else { message = t("library.downloadFailed", ["name": f.fileName]); continue }
            docs.append(FileURLDocument(url: url, name: f.fileName))
        }
        exporting = docs
    }

    /// Each file taken as the core says, or refused with its reason; the names refused said together.
    private func importFiles(_ urls: [URL]) async {
        var failed: [String] = []
        for (n, url) in urls.enumerated() {
            busy = t("images.importing", ["i": n + 1, "n": urls.count])
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            switch kind {
            case .image: if !importImage(url) { failed.append(url.lastPathComponent) }
            case .audio: if !importAudio(url) { failed.append(url.lastPathComponent) }
            case .video: if let why = await VideoImport.run(url, model: model, state: { busy = $0 }) { failed.append(why) }
            }
        }
        busy = nil
        if !failed.isEmpty { message = t("\(kind.library).failed", ["n": failed.count]) + "\n" + failed.joined(separator: "\n") }
    }

    private func importImage(_ url: URL) -> Bool {
        guard let p = PictureFiles.keep(url, model: model) else { return false }
        return change(model, "addImage", ["id": UUID().uuidString.lowercased(), "fileName": url.lastPathComponent, "contentType": "image/jpeg",
                                          "fullHash": p.full, "thumbHash": p.thumb, "width": p.width, "height": p.height, "createdAt": nowMs()]) == nil
    }

    private struct AudioPlan: Decodable { let refused: String?, contentType: String? }

    private func importAudio(_ url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url) else { return false }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
        guard let plan = model.view("mediaImportView", ["kind": "audio", "name": url.lastPathComponent, "size": data.count, "type": type], as: AudioPlan.self),
              plan.refused == nil, let contentType = plan.contentType, let hash = keepFile(data, type: contentType, model: model) else { return false }
        return change(model, "addAudio", ["id": UUID().uuidString.lowercased(), "fileName": url.lastPathComponent, "contentType": contentType,
                                          "hash": hash, "size": data.count, "createdAt": nowMs()]) == nil
    }
}

/// A file to save, read from where it is when it is written (a video can be 2 GB).
struct FileURLDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let url: URL, name: String
    init(url: URL, name: String) { self.url = url; self.name = name }
    init(configuration: ReadConfiguration) throws { throw CocoaError(.fileReadUnsupportedScheme) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let w = try FileWrapper(url: url, options: [])
        w.preferredFilename = name
        return w
    }
}

extension MediaFiles {
    /// A library file on this device: a picture's full one or a sound from the media folder (fetched when missing), a
    /// video fetched from the server by its play address (`POST /api/media/{hash}/play`) to a temporary file.
    @MainActor static func local(_ kind: MediaKind, _ f: MediaFile, model: Model) async -> URL? {
        switch kind {
        case .image: return await file(f.fullHash ?? "", store: model.store)
        case .audio: return await file(f.hash ?? "", store: model.store)
        case .video:
            struct Play: Decodable { let url: String }
            guard let hash = f.hash, let play = await model.api("POST", "/api/media/\(hash)/play", as: Play.self).value,
                  let session = model.session, let server = try? Server(session.server) else { return nil }
            let target = FileManager.default.temporaryDirectory.appending(path: "\(hash)-\(f.fileName)")
            return (try? await server.download(play.url, as: session, to: target)) == true ? target : nil
        }
    }
}

/// The bytes kept in the media folder by their SHA-256 and recorded for the sync: their hash.
@MainActor func keepFile(_ data: Data, type: String, model: Model) -> String? {
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    try? FileManager.default.createDirectory(at: AppScheme.mediaDir, withIntermediateDirectories: true)
    guard (try? data.write(to: AppScheme.mediaDir.appending(path: hash))) != nil else { return nil }
    model.app.recordBlob(hash, contentType: type, size: data.count)
    return hash
}

/// A picture file as SwiftUI's image.
func platformImage(_ url: URL) -> Image? {
    #if os(macOS)
    NSImage(contentsOf: url).map { Image(nsImage: $0) }
    #else
    UIImage(contentsOfFile: url.path).map { Image(uiImage: $0) }
    #endif
}

extension AppState {
    /// A file recorded so a change may name it, and uploaded before that change is pushed (`held` false: a video,
    /// which went up in parts already).
    func recordBlob(_ hash: String, contentType: String, size: Int, held: Bool = true) {
        switch store {
        case let .synced(client): client.recordBlob(hash, contentType: contentType, size: size, held: held)
        case let .demo(core):
            _ = try? core.db.query("INSERT INTO media_blobs (hash, content_type, size, bytes, received_at) VALUES (?, ?, ?, \(held ? "X'00'" : "NULL"), ?) ON CONFLICT (hash) DO NOTHING",
                                   [.text(value: hash), .text(value: contentType), .integer(value: Int64(size)), .integer(value: Int64(nowMs()))])
        case nil: break
        }
    }
}
