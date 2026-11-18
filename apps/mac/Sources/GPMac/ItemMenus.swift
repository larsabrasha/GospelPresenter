// An item's menu and Lägg till's, the same on its row at the left, on its heading's … and on a phone (the web's
// pages/live/ItemContextMenu.tsx and AddChoices.tsx), grouped as Apple groups a menu: opening it (Byt namn for a
// programme item) and Kommentar; Arrangemang ›; Lägg till efter ›, Ny programpunkt ovanför; Radera last, in red.
// Not here yet: Redigera (the song's page), Överlägg ›, Markera, and the kinds but Sång.
import SwiftUI

struct ItemMenu: View {
    @Environment(Model.self) private var model
    let item: ItemView

    var body: some View {
        Section {
            if item.type == "header" {
                Button(t("header.rename"), systemImage: "pencil") {
                    model.prompt = TextPrompt(title: t("header.rename"), label: t("header.name"), text: item.title) { model.run("renameItem", ["itemId": item.id, "title": $0]) }
                }
            }
            Button(t("note.title"), systemImage: "text.bubble") {
                model.prompt = TextPrompt(title: t("note.title"), label: t("note.title"), text: item.note ?? "", allowsEmpty: true) { model.run("setItemNote", ["itemId": item.id, "note": $0]) }
            }
        }
        if item.type == "song" && item.arrangements.count > 1 {
            Section {
                // The song's first arrangement when the item names none, as the web's menu marks it.
                let chosen = item.arrangementId ?? item.arrangements.first?.id
                Menu(t("song.arrangements"), systemImage: "list.number") {
                    Picker(t("song.arrangements"), selection: Binding(get: { chosen }, set: { id in
                        model.run("setItemArrangement", ["itemId": item.id, "arrangementId": id.map { $0 as Any } ?? NSNull()])
                    })) {
                        ForEach(Array(item.arrangements.enumerated()), id: \.element.id) { n, a in
                            Text(a.name ?? "\(t("song.arrangement")) \(n + 1)").tag(Optional(a.id))
                        }
                    }
                    .pickerStyle(.inline)
                }
            }
        }
        Section {
            Menu(t("live.addAfter"), systemImage: "plus") { AddChoices(after: item.id) }
            Button(t("header.above"), systemImage: "text.insert") {
                model.prompt = TextPrompt(title: t("header.new"), label: t("header.name"), text: "") { title in
                    model.run("addHeaderToPresentation", ["itemId": model.newId(), "presentationId": model.selectedPresentation ?? "", "title": title, "beforeItemId": item.id])
                }
            }
        }
        Section {
            let shown = model.isLive && model.live.pointer?.itemId == item.id
            Button(shown ? t("live.shownCannotRemove") : t("common.delete"), systemImage: "trash", role: .destructive) { model.removing = item }
                .disabled(shown)
        }
    }
}

/// What + adds, in the web's order; here Sång, then under a line Programpunkt.
struct AddChoices: View {
    @Environment(Model.self) private var model
    let after: String?

    var body: some View {
        Button(t("add.song"), systemImage: "music.note") { model.addingSong = AddAt(after: after) }
        Divider()
        Button(t("header.kind"), systemImage: "text.alignleft") {
            model.prompt = TextPrompt(title: t("header.new"), label: t("header.name"), text: "") { title in
                var args: [String: Any] = ["itemId": model.newId(), "presentationId": model.selectedPresentation ?? "", "title": title]
                if let after { args["afterItemId"] = after }
                model.run("addHeaderToPresentation", args)
            }
        }
    }
}

extension Model {
    /// Where + adds: right after what is shown while presenting, else at the end.
    var addAfter: String? { isLive ? live.pointer?.itemId : nil }
}

extension View {
    /// Radera, asked first (the web's `presentation.removeConfirm`).
    func removeQuestion(_ model: Model) -> some View {
        confirmationDialog(t("common.delete"), isPresented: Binding(get: { model.removing != nil }, set: { if !$0 { model.removing = nil } }), presenting: model.removing) { item in
            Button(t("common.delete"), role: .destructive) { model.run("removeItem", ["itemId": item.id]) }
        } message: { item in Text(t("presentation.removeConfirm", ["title": item.title])) }
    }
}
