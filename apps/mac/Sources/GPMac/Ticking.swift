// Markera, the running order's select mode (the web's RunningOrder.tsx): an item's menu begins it with that item
// ticked, rows are ticked (⇧-click ticks a range on a Mac) and moved by holding them (the phone's way to move), Markera
// alla, Klar ends it, and the ticked are removed together after a question. What is ticked and may be, and the question's texts, are the core's (`tickView`); the item
// on the outputs cannot be ticked. In columns the running order itself ticks; on a phone a sheet of it does.
import SwiftUI

/// Select mode as the core answers it (`tickView`).
struct TickState: Decodable, Equatable {
    struct Remove: Decodable, Equatable { let title: String, text: String, n: Int, confirm: String, done: String }
    let ticked: [String]
    let last: String?
    let tickable: [String]
    let allTicked: Bool
    let remove: Remove?
}

extension Model {
    /// Select mode after `event` (none: as it stands, the order or the item shown changed), by the core's rule.
    private func ticks(_ event: [String: Any]?, from state: TickState?) -> TickState? {
        var args: [String: Any] = [
            "order": current?.items.map(\.id) ?? [],
            "shownId": (isLive ? live.state.itemId : nil) ?? NSNull(),
            "ticked": state?.ticked ?? [], "last": state?.last ?? NSNull(),
        ]
        if let event { args["event"] = event }
        return view("tickView", args, as: TickState.self)
    }

    /// Markera chosen in `item`'s menu (or from outside a row, nil): select mode begun with it ticked.
    func startTicking(first item: String?) { ticking = ticks(["type": "start", "first": item ?? NSNull()], from: nil) }

    /// A row ticked or unticked; with `range`, every row from the last one ticked to it.
    func tick(_ item: String, range: Bool) { ticking = ticks(["type": "tick", "itemId": item, "range": range], from: ticking) }

    /// Markera alla: every row that may be ticked, or none when all are.
    func tickAll() { ticking = ticks(["type": "all"], from: ticking) }

    /// Select mode as the running order now stands: an item removed or shown since is let go.
    func tickingFollowsOrder() { if let state = ticking { ticking = ticks(nil, from: state) } }

    /// The ticked items removed, after the question was answered; select mode ends.
    func removeTicked() {
        for id in ticking?.ticked ?? [] { if run("removeItem", ["itemId": id]) != "ok" { break } }
        ticking = nil
    }
}

/// The running order in select mode: Markera alla and Klar over the rows, each row its tick (the item shown dimmed and
/// not tickable), and under them Ta bort markerade, which asks first.
struct TickList: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    @State private var asking = false

    var body: some View {
        let state = model.ticking
        VStack(spacing: 0) {
            HStack {
                Button { model.tickAll() } label: {
                    Label(t("presentation.tickAll"), systemImage: state?.allTicked == true ? "checkmark.circle.fill" : "circle")
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
                .accessibilityIdentifier("tick-all")
                Spacer()
                Button(t("presentation.tickDone")) { model.ticking = nil }
                    .buttonStyle(.borderedProminent).tint(.sky).controlSize(.small)
                    .accessibilityIdentifier("tick-done")
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            List {
                // A finger moves a row by holding it, as the web's ≡ (RunningOrder.tsx): on a phone the way to move.
                ForEach(p.items) { item in row(item, state) }
                    .onMove { from, to in
                        var ids = p.items.map(\.id)
                        ids.move(fromOffsets: from, toOffset: to)
                        model.run("reorderItems", ["presentationId": p.id, "itemIds": ids])
                    }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            if let remove = state?.remove {
                Button(role: .destructive) { asking = true } label: {
                    Label(t("presentation.removeTicked", ["n": "\(remove.n)"]), systemImage: Look.symbol("delete"))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered).controlSize(.large).padding(12)
                .accessibilityIdentifier("tick-remove")
                .confirmationDialog(t(remove.title), isPresented: $asking, titleVisibility: .visible) {
                    Button(t(remove.confirm), role: .destructive) { model.removeTicked() }
                } message: { Text(t(remove.text, ["n": "\(remove.n)"])) }
            }
        }
        .onChange(of: p.items.map(\.id)) { _, _ in model.tickingFollowsOrder() }
        .onChange(of: model.live.state.itemId) { _, _ in model.tickingFollowsOrder() }
    }

    private func row(_ item: ItemView, _ state: TickState?) -> some View {
        let ticked = state?.ticked.contains(item.id) == true
        let tickable = state?.tickable.contains(item.id) == true
        return Button { model.tick(item.id, range: rangeHeld) } label: {
            HStack(spacing: 10) {
                Image(systemName: ticked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(ticked ? Color.sky : .secondary).font(.title3)
                Label(item.title, systemImage: icon(item.type)).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "line.3.horizontal").foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .frame(minHeight: 36)
        }
        .buttonStyle(.plain)
        .disabled(!tickable)
        .opacity(tickable ? 1 : 0.4)
        .listRowBackground(ticked ? Color.sky.opacity(0.12) : Color.clear)
        .accessibilityIdentifier("tick-\(item.id)")
        .accessibilityAddTraits(ticked ? .isSelected : [])
    }

    /// ⇧ held with the click: a range, as the web's Shift+click and a Mac's list.
    private var rangeHeld: Bool {
        #if os(macOS)
        NSEvent.modifierFlags.contains(.shift)
        #else
        false
        #endif
    }
}
