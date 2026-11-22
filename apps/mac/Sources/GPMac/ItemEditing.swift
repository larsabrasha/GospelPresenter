// Redigera from an item's menu (the web's ItemContextMenu.tsx and ItemParts.tsx): a song's page, a custom slideshow's
// editor, or an image item's own pictures, in a sheet over the presentation, which they return to when closed. Where
// each leads is the core's (`itemActionsView`'s `opens`). A song's page and the slideshow's editor are Inställningar's
// own; the pictures are the item's: dragged to a new order, each removed after a question, more added from the library
// (AddLibrarySheet with the item).
import SwiftUI

/// What Redigera opened: the page and its id (a song, a slideshow, an item).
struct EditTarget: Identifiable, Hashable {
    let page: String, id: String
    init(_ opens: MenuAction.Opens) { (page, id) = (opens.page, opens.id) }
}

struct ItemEditing: View {
    @Environment(Model.self) private var model
    let target: EditTarget
    let p: PresentationView

    var body: some View {
        NavigationStack {
            Group {
                switch target.page {
                case "song": SongEditorPage(id: target.id)
                case "customSlide": SlideEditorPage(target: .slideshow(target.id))
                default: ImageItemEditor(itemId: target.id, p: p)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.close"), systemImage: "xmark") { model.editing = nil }.accessibilityIdentifier("edit-close")
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 720, minHeight: 560)
        #endif
    }
}

/// An image item's pictures (SlideGrid.razor's image edit mode): one under the other, dragged to a new place, each
/// removed after a question; removing the last leaves the item without pictures, as on the web.
struct ImageItemEditor: View {
    @Environment(Model.self) private var model
    let itemId: String
    let p: PresentationView
    @State private var removing: Int?
    @State private var adding: AddKindAt?

    /// A picture's place in the item's own list (its slide's key, `image{n}`): a picture gone is not shown, so the
    /// place among those shown may be another.
    private func place(_ slide: Slide) -> Int? { Int(slide.key.dropFirst("image".count)) }

    private var item: ItemView? { model.current?.items.first { $0.id == itemId } ?? p.items.first { $0.id == itemId } }

    var body: some View {
        let item = item
        let slides = item?.slides ?? []
        List {
            ForEach(Array(slides.enumerated()), id: \.element.key) { n, slide in
                HStack(spacing: 12) {
                    SlideThumbnail(slide: slide, theme: p.theme).frame(width: 192).clipShape(RoundedRectangle(cornerRadius: 8))
                    Text("\(n + 1)").foregroundStyle(.secondary)
                    Spacer()
                    #if os(macOS)
                    // A Mac's row its red ✕, as the web's; iOS's edit mode has its own red − and Radera.
                    Button(role: .destructive) { removing = place(slide) } label: { Image(systemName: "xmark.circle.fill").font(.title2) }
                        .buttonStyle(.plain).foregroundStyle(.red)
                        .accessibilityLabel(t("presentation.removeImage", ["n": "\(n + 1)"]))
                    #endif
                }
                .accessibilityIdentifier("image-\(n)")
            }
            .onDelete { rows in removing = rows.first.flatMap { slides.indices.contains($0) ? place(slides[$0]) : nil } }
            .onMove { from, to in
                // List's `to` counts the place before the row moved; the mutator's the place it ends at, both in the
                // item's own list.
                guard let from = from.first, slides.indices.contains(from) else { return }
                let at = min(to > from ? to - 1 : to, slides.count - 1)
                guard let a = place(slides[from]), let b = place(slides[at]) else { return }
                model.run("moveItemImage", ["itemId": itemId, "from": a, "to": b])
            }
        }
        .navigationTitle(item?.title ?? "")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(t("presentation.addMoreImages"), systemImage: "plus") { adding = AddKindAt(kind: "image", after: nil, toItemId: itemId) }
            }
        }
        .sheet(item: $adding) { at in AddLibrarySheet(at: at) }
        .confirmationDialog(t("common.delete"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button(t("common.delete"), role: .destructive) {
                if let n = removing { model.run("removeItemImage", ["itemId": itemId, "index": n]) }
            }
        } message: { Text(t("presentation.removeImageConfirm")) }
        #if os(iOS)
        .environment(\.editMode, .constant(.active))
        #endif
    }
}
