// Välj, as every library of the web's has it (ui/Selecting.tsx, Lars 2026-11-07): the list's rows picked by a tap while
// it is on, the actions for those picked in the bar, Klar to end it. A row shows its mark at its start.
import SwiftUI

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

/// The bar's Välj, or while it is on the actions for what is picked and Klar.
struct PickingToolbar<Actions: View>: ToolbarContent {
    @Binding var picking: Picking
    @ViewBuilder let actions: Actions

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if picking.on {
                actions.disabled(picking.ids.isEmpty)
                Button(t("library.done")) { picking.end() }
            } else {
                Button(t("library.select")) { picking.on = true }
            }
        }
    }
}
