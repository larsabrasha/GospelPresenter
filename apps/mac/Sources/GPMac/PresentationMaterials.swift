// Noter och länkar for a presentation (spec 02 "Song material"; the web's PresentationMaterials.tsx), from the
// presentation's menu: its songs' sheet music, recordings and links in the running order, so the band finds all it
// plays in one place; which songs and in which order the core's (`presentationMaterialsView`). Read only: materials are
// added on the song's page. A link opens in the browser, a file in Quick Look, fetched first where this device lacks it.
import SwiftUI

struct PresentationMaterials: View {
    @Environment(Model.self) private var model
    @Environment(\.openURL) private var openURL
    let presentationId: String
    @State private var viewing: URL?

    private struct Answer: Decodable {
        struct Song: Decodable, Identifiable { let songId: String, title: String, materials: [MaterialsPage.Material]; var id: String { songId } }
        let songs: [Song]
        let empty: String?
    }

    var body: some View {
        let answer = model.view("presentationMaterialsView", ["presentationId": presentationId], as: Answer.self)
        NavigationStack {
            List {
                ForEach(answer?.songs ?? []) { song in
                    Section(song.title) {
                        ForEach(song.materials) { m in
                            Button { open(m) } label: {
                                Label(m.title, systemImage: m.kind == "link" ? "link" : m.contentType == "application/pdf" ? "doc.richtext" : "waveform")
                            }
                            .accessibilityIdentifier("material-\(m.id)")
                        }
                    }
                }
            }
            .overlay { if let empty = answer?.empty { ContentUnavailableView(t(empty), systemImage: "paperclip") } }
            .navigationTitle(t("material.title"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.close"), systemImage: "xmark") { model.showingMaterials = false }.accessibilityIdentifier("materials-close")
                }
            }
            .quickLookPreview($viewing)
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 420)
        #endif
    }

    private func open(_ m: MaterialsPage.Material) {
        if let url = m.url.flatMap(URL.init(string:)) { openURL(url); return }
        guard let hash = m.hash else { return }
        Task { viewing = await MediaFiles.file(hash, store: model.store).map { MaterialsPage.named($0, m) } }
    }
}
