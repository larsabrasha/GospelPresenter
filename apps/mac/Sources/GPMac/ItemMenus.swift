// An item's menu and Lägg till's, the same on its row at the left, on its heading's … and on a phone (the web's
// pages/live/ItemContextMenu.tsx and AddChoices.tsx). What it offers, in which groups and which entries can be chosen,
// is the core's (`itemActionsView`, docs/view-models.md); this file only draws each entry as Apple draws a menu's.
// Not here yet, so left out: Redigera (the song's page), Redigera bilder, Överlägg ›, Markera.
import SwiftUI

struct ItemMenu: View {
    @Environment(Model.self) private var model
    @Environment(\.wideLayout) private var wide
    let item: ItemView

    /// The entries this app draws; the core's others wait for their pages.
    private static let drawn: Set = ["rename", "note", "arrangement", "addAfter", "headerAbove", "delete"]

    var body: some View {
        ForEach(model.itemActions(item, wide: wide), id: \.id) { group in
            Section {
                ForEach(group.actions.filter { Self.drawn.contains($0.id) }, id: \.id) { entry($0) }
            }
        }
    }

    @ViewBuilder private func entry(_ a: MenuAction) -> some View {
        switch a.id {
        case "rename":
            Button(t(a.text), systemImage: "pencil") {
                model.prompt = TextPrompt(title: t(a.text), label: t("header.name"), text: item.title, rule: model.rule("itemTitle")) { model.run("renameItem", ["itemId": item.id, "title": $0]) }
            }
        case "note":
            Button(t(a.text), systemImage: "text.bubble") {
                model.prompt = TextPrompt(title: t(a.text), label: t(a.text), text: item.note ?? "", rule: model.rule("itemNote")) { model.run("setItemNote", ["itemId": item.id, "note": $0]) }
            }
        case "arrangement":
            Menu(t(a.text), systemImage: "list.number") {
                Picker(t(a.text), selection: Binding(get: { a.chosen }, set: { id in
                    model.run("setItemArrangement", ["itemId": item.id, "arrangementId": id.map { $0 as Any } ?? NSNull()])
                })) {
                    ForEach(a.choices ?? [], id: \.id) { c in
                        Text(c.name ?? "\(t("song.arrangement")) \(c.n ?? 0)").tag(Optional(c.id))
                    }
                }
                .pickerStyle(.inline)
            }
        case "addAfter":
            Menu(t(a.text), systemImage: "plus") { AddChoices(chosen: item.id) }
        case "headerAbove":
            Button(t(a.text), systemImage: "text.insert") {
                model.prompt = TextPrompt(title: t("header.new"), label: t("header.name"), text: "", rule: model.rule("itemTitle")) { title in
                    model.run("addHeaderToPresentation", ["itemId": model.newId(), "presentationId": model.selectedPresentation ?? "", "title": title, "beforeItemId": item.id])
                }
            }
        case "delete":
            Button(t(a.text), systemImage: "trash", role: a.destructive ? .destructive : nil) { model.removing = item }
                .disabled(!a.enabled)
        default:
            EmptyView()
        }
    }
}

/// What + adds, in the web's order; here Sång, then under a line Programpunkt. `chosen` is the item "Lägg till efter"
/// named, none for +.
struct AddChoices: View {
    @Environment(Model.self) private var model
    @Environment(\.wideLayout) private var wide
    let chosen: String?

    var body: some View {
        Button(t("add.song"), systemImage: "music.note") { model.addingSong = AddAt(after: model.afterFor(chosen, wide: wide)) }
        Divider()
        Button(t("header.kind"), systemImage: "text.alignleft") {
            let after = model.afterFor(chosen, wide: wide)
            model.prompt = TextPrompt(title: t("header.new"), label: t("header.name"), text: "", rule: model.rule("itemTitle")) { title in
                let itemId = model.newId()
                var args: [String: Any] = ["itemId": itemId, "presentationId": model.selectedPresentation ?? "", "title": title]
                if let after { args["afterItemId"] = after }
                if model.run("addHeaderToPresentation", args) == "ok" { model.added(itemId) }
            }
        }
    }
}

extension Model {
    /// The item an addition goes after, as the web's two layouts ask it: in columns (PresentationEditor's `afterFor`)
    /// the core's `addPositionView` while presenting, else the item chosen or selected; in one column (PhoneLive's)
    /// the core's view always, with the shown item only while presenting and no selected item. The two differ before
    /// presenting, as the web's do.
    func afterFor(_ chosen: String?, wide: Bool) -> String? {
        let order = current?.items.map(\.id) ?? []
        let shown: Any = isLive ? (live.pointer?.itemId ?? NSNull()) : NSNull()
        let last: Any = lastAddedId ?? NSNull(), pick: Any = chosen ?? NSNull()
        if wide {
            guard isLive else { return chosen ?? selectedItem }
            return view("addPositionView", ["order": order, "shownId": shown, "lastAddedId": last, "chosenId": pick, "selectedId": selectedItem ?? NSNull()], as: String?.self) ?? nil
        }
        return view("addPositionView", ["order": order, "shownId": shown, "lastAddedId": last, "chosenId": pick], as: String?.self) ?? nil
    }

    /// An item's menu, the core's (`itemActionsView`): the item, its song, the song's arrangements, the overlays, and
    /// the item shown, which cannot be removed. In columns a black screen shows nothing, as the web's computer page
    /// has it; in one column the item stays shown under black, as the web's phone sheet has it (the two differ).
    func itemActions(_ item: ItemView, wide: Bool) -> [MenuGroups.Group] {
        let pointer = isLive ? live.pointer : nil
        let shown: Any = (wide && pointer?.black == true ? nil : pointer?.itemId) ?? NSNull()
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
    func added(_ itemId: String) {
        lastAddedId = itemId
        selectedItem = itemId
    }
}

private struct WideLayoutKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// The presentation is in columns (≥ 1 000 pt), not one column.
    var wideLayout: Bool {
        get { self[WideLayoutKey.self] }
        set { self[WideLayoutKey.self] = newValue }
    }
}

extension View {
    /// Radera, asked first (the web's `presentation.removeConfirm`).
    func removeQuestion(_ model: Model) -> some View {
        confirmationDialog(t("common.delete"), isPresented: Binding(get: { model.removing != nil }, set: { if !$0 { model.removing = nil } }), presenting: model.removing) { item in
            Button(t("common.delete"), role: .destructive) { model.run("removeItem", ["itemId": item.id]) }
        } message: { item in Text(t("presentation.removeConfirm", ["title": item.title])) }
    }
}
