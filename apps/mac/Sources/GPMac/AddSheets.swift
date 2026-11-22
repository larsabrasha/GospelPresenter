// Lägg till's other kinds (the web's AddItemDialog.tsx with ImageTab, AudioTab, VideoTab and SlidesTab): a library's
// pictures, sounds, videos or slideshows, searched and ordered as the core orders them (`libraryOrderView`), picked and
// added as the core says (`addPickView`: pictures many at a time in the order tapped, the rest one at a time). The
// sheet stays open after an add (D15), the next following the last. Importera puts new files in the library first, as
// Inställningar's does (MediaImporter). The Bible's own sheet is BibleSheet.swift.
import SwiftUI

/// A kind to add and the item it goes after; `toItemId` adds pictures to that item instead (Redigera bilder's +).
struct AddKindAt: Identifiable {
    let id = UUID()
    let kind: String
    let after: String?
    var toItemId: String? = nil
}

private struct AddableRows: Decodable { let rows: [AddableRow] }

/// A row of a library as `libraryOrderView` gives it: a file's (its name `fileName`) or a slideshow's (`name`).
private struct AddableRow: Decodable, Identifiable, Hashable {
    let id: String
    let fileName: String?, name: String?, thumbHash: String?, stillHash: String?
    var title: String { fileName ?? name ?? "" }
}

private struct AddPick: Decodable {
    struct Command: Decodable { let name: String, args: JSONValue }
    struct Text: Decodable { let key: String, n: Int }
    let picked: [String]
    let many: Bool
    let add: Command?
    let title: Text?
}

struct AddLibrarySheet: View {
    @Environment(Model.self) private var model
    let at: AddKindAt
    @State private var query = ""
    @State private var picked: [String] = []
    @State private var added: String?
    @State private var importing = false
    @State private var message: String?

    private var library: String { ["image": "images", "audio": "audios", "video": "videos", "slides": "customSlides"][at.kind] ?? "images" }
    private var kindText: String { ["image": "add.image", "audio": "presentation.audioTab", "video": "presentation.videoTab", "slides": "add.slides"][at.kind] ?? "add.image" }
    private var symbol: String { ["image": "photo", "audio": "speaker.wave.2", "video": "video", "slides": "rectangle.on.rectangle"][at.kind] ?? "photo" }

    private func pick(_ event: [String: Any]? = nil) -> AddPick? {
        var args: [String: Any] = ["kind": at.kind, "picked": picked, "presentationId": model.selectedPresentation ?? "", "itemId": model.newId(),
                                   "afterItemId": (added ?? at.after) ?? NSNull()]
        if let to = at.toItemId { args["toItemId"] = to }
        if let event { args["event"] = event }
        return model.view("addPickView", args, as: AddPick.self)
    }

    var body: some View {
        let rows = model.view("libraryOrderView", ["kind": library, "query": query, "locale": Texts.language], as: AddableRows.self)?.rows ?? []
        let now = pick()
        List {
            // A field of the sheet's own, as the Bible sheet's: a system search would cover the bar's Lägg till while
            // typing (the core filters, `libraryOrderView`'s query).
            Section {
                TextField(t("presentation.searchImages"), text: $query)
                    .textFieldStyle(.roundedBorder).autocorrectionDisabled()
                    .accessibilityIdentifier("library-search")
            }
            .listRowBackground(Color.clear)
            ForEach(rows) { row in
            Button { picked = pick(["type": "toggle", "id": row.id])?.picked ?? picked } label: {
                HStack(spacing: 12) {
                    thumbnail(row).frame(width: 96, height: 54).clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(row.title).lineLimit(1)
                    Spacer()
                    if let n = picked.firstIndex(of: row.id) {
                        Image(systemName: now?.many == true ? "\(n + 1).circle.fill" : "checkmark.circle.fill").foregroundStyle(Color.sky).font(.title3)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pick-\(row.id)")
            .accessibilityAddTraits(picked.contains(row.id) ? .isSelected : [])
            }
            // A row of the list, not over it: the search field stays to type in when nothing is found.
            if rows.isEmpty {
                ContentUnavailableView(t(MediaKind(rawValue: at.kind)?.emptyKey ?? "customSlides.empty"), systemImage: symbol).listRowBackground(Color.clear)
            }
        }
        .toolbar {
            if at.kind != "slides" {
                ToolbarItem(placement: .primaryAction) {
                    Button(t("images.import"), systemImage: "square.and.arrow.down") { importing = true }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: MediaKind(rawValue: at.kind)?.accepts ?? [], allowsMultipleSelection: true) { result in
            guard case let .success(urls) = result, let kind = MediaKind(rawValue: at.kind) else { return }
            Task { message = await MediaImporter.run(kind, urls, model: model) { _ in } }
        }
        .sheetBar(t("presentation.addKind", ["kind": t(kindText).lowercased()]), cancel: t("common.close"), confirm: t("presentation.add"), disabled: now?.add == nil) { add(now) }
        .refusal($message)
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 520)
        #endif
    }

    @ViewBuilder private func thumbnail(_ row: AddableRow) -> some View {
        if let hash = row.thumbHash ?? row.stillHash, let image = platformImage(AppScheme.mediaDir.appending(path: hash)) {
            image.resizable().scaledToFill()
        } else {
            Image(systemName: symbol).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.raised)
        }
    }

    /// The pick added by the core's command, the item named in this language where it is several pictures; the sheet
    /// stays open, the next addition following this one, unless the pictures went to an item of their own.
    private func add(_ now: AddPick?) -> Bool {
        guard let command = now?.add, case var .object(args) = command.args else { return false }
        if let title = now?.title { args["title"] = .string(t(title.key, ["n": title.n])) }
        guard model.run(command.name, JSONValue.object(args).any as? [String: Any] ?? [:]) == "ok" else { return false }
        picked = []
        guard at.toItemId == nil, let itemId = args["itemId"]?.string else { return true }
        model.added(itemId)
        added = itemId
        return false
    }
}
