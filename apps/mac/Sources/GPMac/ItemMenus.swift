// An item's menu and Lägg till's, the same on its row at the left, on its heading's … and on a phone (the web's
// pages/live/ItemContextMenu.tsx and AddChoices.tsx). What it offers, in which groups and which entries can be chosen,
// is the core's (`itemActionsView`, docs/view-models.md); this file only draws each entry as Apple draws a menu's.
// Not here yet, so left out: Redigera (the song's page), Redigera bilder, Markera.
import SwiftUI

struct ItemMenu: View {
    @Environment(Model.self) private var model
    let item: ItemView

    /// The entries this app draws; the core's others wait for their pages.
    private static let drawn: Set = ["rename", "note", "arrangement", "overlay", "addAfter", "delete"]

    var body: some View {
        ForEach(model.itemActions(item), id: \.id) { group in
            Section {
                ForEach(group.actions.filter { Self.drawn.contains($0.id) }, id: \.id) { entry($0) }
            }
        }
        // Each entry with its icon, as the web's menu has them; a Mac's menu shows the title alone unless asked.
        .labelStyle(.titleAndIcon)
    }

    @ViewBuilder private func entry(_ a: MenuAction) -> some View {
        switch a.id {
        case "rename":
            Button(t(a.text), systemImage: Look.symbol(a.icon)) {
                model.prompt = TextPrompt(title: t(a.text), label: t("header.name"), text: item.title, rule: model.rule("itemTitle")) { model.run("renameItem", ["itemId": item.id, "title": $0]) }
            }
        case "note":
            Button(t(a.text), systemImage: Look.symbol(a.icon)) {
                model.prompt = TextPrompt(title: t(a.text), label: t(a.text), text: item.note ?? "", rule: model.rule("itemNote")) { model.run("setItemNote", ["itemId": item.id, "note": $0]) }
            }
        case "arrangement":
            Menu(t(a.text), systemImage: Look.symbol(a.icon)) {
                Picker(t(a.text), selection: Binding(get: { a.chosen }, set: { id in
                    model.run("setItemArrangement", ["itemId": item.id, "arrangementId": id.map { $0 as Any } ?? NSNull()])
                })) {
                    ForEach(a.choices ?? [], id: \.id) { c in
                        // Original's a text key; an arrangement without a name by its place.
                        Text(c.name ?? c.text.map { t($0) } ?? "\(t("song.arrangement")) \(c.n ?? 0)").tag(Optional(c.id))
                    }
                }
                .pickerStyle(.inline)
            }
        case "overlay":
            // Ingen (the empty id, a text key) and the organisation's overlays by name; the item's own ticked.
            Menu(t(a.text), systemImage: Look.symbol(a.icon)) {
                Picker(t(a.text), selection: Binding(get: { a.chosen ?? "" }, set: { id in
                    model.run("setItemOverlay", ["itemId": item.id, "overlayId": id.isEmpty ? NSNull() : id as Any])
                })) {
                    ForEach(a.choices ?? [], id: \.id) { c in Text(c.name ?? c.text.map { t($0) } ?? "").tag(c.id) }
                }
                .pickerStyle(.inline)
            }
        case "addAfter":
            Menu(t(a.text), systemImage: Look.symbol(a.icon)) { AddChoices(chosen: item.id) }
        case "delete":
            Button(t(a.text), systemImage: Look.symbol(a.icon), role: a.destructive ? .destructive : nil) { model.removing = item }
                .disabled(!a.enabled)
        default:
            EmptyView()
        }
    }
}

/// What + adds: the kinds, their texts, icons and order the core's (`pageButtonsView`'s Lägg till, the web's), the one
/// set apart under a line. `chosen` is the item "Lägg till efter" named, none for +. Not here yet, so left out: Bibeltext,
/// Bild, Ljud, Video, Bildspel.
struct AddChoices: View {
    @Environment(Model.self) private var model
    let chosen: String?

    /// The kinds this app can add.
    private static let drawn: Set = ["song", "header"]

    var body: some View {
        let kinds = (model.view("pageButtonsView", ["place": "runningOrder"], as: PageButtons.self)?.buttons.first { $0.id == "add" }?.choices ?? [])
            .filter { Self.drawn.contains($0.id) }
        ForEach(kinds, id: \.id) { k in
            if k.apart == true { Divider() }
            Button(t(k.text ?? k.id), systemImage: Look.symbol(k.icon)) { add(k.id) }
        }
        .labelStyle(.titleAndIcon)
    }

    private func add(_ kind: String) {
        let after = model.afterFor(chosen)
        guard kind == "header" else { model.addingSong = AddAt(after: after); return }
        model.prompt = TextPrompt(title: t("header.new"), label: t("header.name"), text: "", rule: model.rule("itemTitle")) { title in
            let itemId = model.newId()
            var args: [String: Any] = ["itemId": itemId, "presentationId": model.selectedPresentation ?? "", "title": title]
            if let after { args["afterItemId"] = after }
            if model.run("addHeaderToPresentation", args) == "ok" { model.added(itemId) }
        }
    }
}

extension Model {
    /// The item an addition goes after, the core's one rule (`addPositionView`), in columns and in one column alike:
    /// the selection is the page's state's, which a part tapped sets on a phone too.
    func afterFor(_ chosen: String?) -> String? {
        let args: [String: Any] = [
            "order": current?.items.map(\.id) ?? [],
            "shownId": isLive ? (live.state.itemId ?? NSNull()) : NSNull(),
            "lastAddedId": lastAddedId ?? NSNull(), "chosenId": chosen ?? NSNull(),
            "selectedId": selectedItem ?? NSNull(),
        ]
        return view("addPositionView", args, as: String?.self) ?? nil
    }

    /// An item's menu, the core's (`itemActionsView`): the item, its song, the song's arrangements, the overlays, and
    /// the item on the outputs, black or not, which cannot be removed.
    func itemActions(_ item: ItemView) -> [MenuGroups.Group] {
        let shown: Any = (isLive ? live.state.itemId : nil) ?? NSNull()
        let itemArgs: [String: Any] = ["id": item.id, "type": item.type, "arrangementId": item.arrangementId ?? NSNull(), "overlayId": item.overlayId ?? NSNull()]
        let args: [String: Any] = [
            "item": itemArgs,
            "song": item.song?.any ?? NSNull(),
            "arrangements": item.arrangements.map { ["id": $0.id, "name": $0.name ?? NSNull()] as [String: Any] },
            "overlays": current?.overlays.map(\.any) ?? [],
            "shownId": shown,
        ]
        return view("itemActionsView", args, as: MenuGroups.self)?.groups ?? []
    }

    /// An item just added: the next addition follows it while it is ahead of the shown one, and it is selected.
    func added(_ itemId: String) { send(["type": "added", "itemId": itemId]) }
}

extension View {
    /// Radera, asked first (the web's `presentation.removeConfirm`); with `item`, only for that item, so a phone's
    /// question points at the item's own … (iOS 26 shows it as a popover from the view it is on).
    func removeQuestion(_ model: Model, item only: ItemView? = nil) -> some View {
        let asked = { model.removing != nil && (only == nil || model.removing?.id == only?.id) }
        return confirmationDialog(t("common.delete"), isPresented: Binding(get: asked, set: { if !$0 { model.removing = nil } }), presenting: model.removing) { item in
            Button(t("common.delete"), role: .destructive) { model.run("removeItem", ["itemId": item.id]) }
        } message: { item in Text(t("presentation.removeConfirm", ["title": item.title])) }
    }
}
