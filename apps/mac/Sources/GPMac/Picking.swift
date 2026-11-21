// Välj, as every library of the web's has it (ui/Selecting.tsx, Lars 2026-11-07): the list's rows picked by a tap while
// it is on, the actions for those picked in the bar, Klar to end it. A row shows its mark at its start. On a Mac there
// is no Välj (Lars, 2026-11-21): the list picks rows itself, a click one and ⌘- or ⇧-click more, as Finder's, and a
// double click or ↵ opens one; the actions for those picked show in the bar while any are.
import SwiftUI

/// What a list of Inställningar can do, as the core says it (`libraryPageView`): how this platform does each is ours.
struct LibraryPage: Decodable {
    struct Action: Decodable, Hashable { let id: String, text: String, destructive: Bool, when: String? }
    struct Add: Decodable { let id: String, text: String, title: String? }
    let list: String, opens: String, add: Add?, extra: Add?, pick: Bool, pickOnly: String?, picked: [Action], row: [Action]
}

extension Model {
    /// The list of `kind`'s page for this user's role (`host`: this app is the desktop host itself, never so here).
    func libraryPage(_ kind: String, host: Bool = false) -> LibraryPage? {
        view("libraryPageView", ["kind": kind, "role": role, "host": host], as: LibraryPage.self)
    }
}

/// The core's actions as buttons, in its order, each doing what `perform` makes of its id; one that needs a field
/// (`when`) the row has not (`has`) is left out, as Ersätt for a slideshow that is no deck's.
struct ActionButtons: View {
    let actions: [LibraryPage.Action]
    var has: (String) -> Bool = { _ in true }
    let perform: (String) -> Void

    var body: some View {
        ForEach(actions.filter { $0.when.map(has) ?? true }, id: \.self) { a in
            // Named by the core's id, as every platform names it (docs/view-models.md, "Ids").
            Button(t(a.text), systemImage: Self.symbol(a.id), role: a.destructive ? .destructive : nil) { perform(a.id) }
                .accessibilityIdentifier(a.id)
        }
    }

    /// An action's symbol, this platform's (docs/native-apps.md).
    static func symbol(_ id: String) -> String {
        switch id {
        case "rename": "pencil"
        case "download": "square.and.arrow.down"
        case "restore", "revert": "arrow.uturn.backward"
        case "replace": "arrow.triangle.2.circlepath"
        case "edit": "slider.horizontal.3"
        case "delete", "purge": "trash"
        default: "circle"
        }
    }
}

extension View {
    /// The page's + and the action beside it, as the core gives them; none where it gives none.
    func floatingAdd(_ page: LibraryPage?, shown: Bool = true, add: @escaping () -> Void, extra: @escaping () -> Void = {}) -> some View {
        floatingAdd(page?.add.map { t($0.text) } ?? "", id: page?.add?.id, shown: shown && page?.add != nil, add: add,
                    extra: page?.extra.map { FloatingAction(text: t($0.text), icon: "square.and.arrow.down", id: $0.id, action: extra) })
    }
}

/// The list's selection: the picked rows on a Mac, none on iOS (Välj picks there).
func listSelection(_ picking: Binding<Picking>) -> Binding<Set<String>>? {
    #if os(macOS)
    picking.ids
    #else
    nil
    #endif
}

/// A library's row: on a Mac a row of the list's selection, opened and acted on through `libraryPicking`; on iOS its
/// link (with its menu and swipe), or its mark while Välj is on.
struct LibraryRow<Label: View, Link: View>: View {
    @Binding var picking: Picking
    let id: String
    let label: Label
    @ViewBuilder let link: (Label) -> Link

    var body: some View {
        #if os(macOS)
        label.tag(id)
        #else
        if picking.on { PickRow(picking: $picking, id: id) { label } } else { link(label) }
        #endif
    }
}

extension View {
    /// On a Mac the picked rows' menu (a right click), a double click or ↵ opening the one picked, and ⌫ asking to
    /// remove them; nothing on iOS, where each row's link and menu do it.
    @ViewBuilder
    func libraryPicking<Menu: View>(_ picking: Picking, open: @escaping (String) -> Void, remove: (() -> Void)? = nil,
                                    @ViewBuilder menu: @escaping (Set<String>) -> Menu) -> some View {
        #if os(macOS)
        contextMenu(forSelectionType: String.self, menu: menu) { ids in if ids.count == 1, let id = ids.first { open(id) } }
            .onDeleteCommand { if let remove, !picking.ids.isEmpty { remove() } }
        #else
        self
        #endif
    }
}

/// A tile's clicks, where the list's selection does not reach (a grid): on a Mac a double click opens it and a click
/// picks it; on iOS a tap does what `tap` says.
struct Clicks: ViewModifier {
    let open: () -> Void
    let tap: () -> Void

    func body(content: Content) -> some View {
        #if os(macOS)
        content.onTapGesture(count: 2, perform: open).onTapGesture(perform: tap)
        #else
        content.onTapGesture(perform: tap)
        #endif
    }
}

/// A row picked on a Mac, outside a list's own selection: the selection's tint behind it.
struct MacPicked: ViewModifier {
    let on: Bool
    let radius: CGFloat

    func body(content: Content) -> some View {
        #if os(macOS)
        content.background(Color.sky.opacity(on ? 0.25 : 0), in: RoundedRectangle(cornerRadius: radius))
        #else
        content
        #endif
    }
}

/// Sortera as a menu behind its symbol, its choices checked, as Apple's apps sort a list; not a field in the bar.
struct SortMenu: View {
    let sorts: [(id: String, text: String)]
    @Binding var selection: String

    var body: some View {
        let current = sorts.first { $0.id == selection }.map { t($0.text) } ?? ""
        Menu {
            Picker(t("library.sortBy", ["order": current]), selection: $selection) {
                ForEach(sorts, id: \.id) { s in Text(t(s.text)).tag(s.id) }
            }
            .pickerStyle(.inline)
        } label: { Label(t("library.sortBy", ["order": current]), systemImage: "arrow.up.arrow.down") }
    }
}

struct Picking: Equatable {
    var on = false
    var ids: Set<String> = []

    mutating func toggle(_ id: String) { if ids.contains(id) { ids.remove(id) } else { ids.insert(id) } }
    mutating func end() { on = false; ids = [] }
}

/// A row while Välj is on: its mark, then the row, the whole of it a tap that picks it.
struct PickRow<Content: View>: View {
    @Binding var picking: Picking
    let id: String
    @ViewBuilder let content: Content

    var body: some View {
        Button { picking.toggle(id) } label: {
            HStack(spacing: 12) {
                Image(systemName: picking.ids.contains(id) ? "checkmark.circle.fill" : "circle").foregroundStyle(Color.sky).imageScale(.large)
                content
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(picking.ids.contains(id) ? .isSelected : [])
    }
}

/// The bar's Välj, or while it is on the actions for what is picked and Klar; none where the core says rows are not
/// picked (`shown`).
struct PickingToolbar<Actions: View>: ToolbarContent {
    @Binding var picking: Picking
    var shown = true
    @ViewBuilder let actions: Actions

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            #if os(macOS)
            if shown, !picking.ids.isEmpty { actions }
            #else
            if shown, picking.on {
                actions.disabled(picking.ids.isEmpty)
                Button(t("library.done")) { picking.end() }
            } else if shown {
                Button(t("library.select")) { picking.on = true }
            }
            #endif
        }
    }
}
