// Papperskorg (the web's Trash.tsx), as the core lays it out (`trashPageView`): the kinds the user manages, newest
// deletion first, the days each has left; Återställ and Radera permanent per row, by swiping or its menu; Töm
// papperskorgen last, in red. Opening it purges what has passed its 30 days, as the web's does.
import SwiftUI

struct TrashEntry: Decodable, Identifiable, Hashable {
    let kind: String, id: String, name: String, detail: String?, deletedAt: Double, daysLeft: Int, restore: String, purge: String
    var key: String { "\(kind):\(id)" }
}

struct TrashPageModel: Decodable { let entries: [TrashEntry], kinds: [String], kind: String?, total: Int, expired: Bool }

/// Now in milliseconds, as the mutators' `at` and `now`.
func nowMs() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

/// A change sent and, when refused, its words: what every settings page does with a button's mutation.
@MainActor func change(_ model: Model, _ name: String, _ args: [String: Any]) -> String? {
    let outcome = model.app.mutate(name, args)
    return outcome == "ok" ? nil : refusalText(outcome)
}

struct TrashPage: View {
    @Environment(Model.self) private var model
    @State private var kind: String?
    @State private var query = ""
    @State private var opened = nowMs()
    @State private var purging: TrashEntry?
    @State private var emptying = false
    @State private var picking = Picking()
    @State private var purgingMany = false
    @State private var message: String?

    private var page: TrashPageModel? {
        var args: [String: Any] = ["role": model.role, "now": opened, "query": query]
        if let kind { args["kind"] = kind }
        return model.view("trashPageView", args, as: TrashPageModel.self)
    }

    var body: some View {
        let page = page
        List {
            if let page, page.kinds.count > 1 {
                Picker(t("trash.title"), selection: $kind) {
                    Text(t("trash.all")).tag(String?.none)
                    ForEach(page.kinds, id: \.self) { k in Text(t("trash.kind.\(k)")).tag(String?.some(k)) }
                }
                .pickerStyle(.segmented).labelsHidden()
            }
            if let page {
                Section {
                    ForEach(page.entries) { e in
                        if picking.on { PickRow(picking: $picking, id: e.key) { row(e) } } else { row(e) }
                    }
                } footer: {
                    if page.total > 0 { Text(page.entries.count == 1 ? t("trash.countOne") : t("trash.countMany", ["n": page.entries.count])) }
                }
                if page.total > 0 {
                    Section { Button(t("trash.empty"), role: .destructive) { emptying = true } }
                }
            }
        }
        .overlay {
            if page?.total == 0 { ContentUnavailableView(t("trash.emptyTitle"), systemImage: "trash") }
            else if page?.entries.isEmpty == true { ContentUnavailableView(t("trash.noMatch"), systemImage: "magnifyingglass") }
        }
        .searchable(text: $query, prompt: t("trash.search"))
        .toolbar {
            if page?.total ?? 0 > 0 {
                PickingToolbar(picking: $picking) {
                    Button(t("common.restore"), systemImage: "arrow.uturn.backward") {
                        let picked = (page?.entries ?? []).filter { picking.ids.contains($0.key) }
                        for e in picked { message = change(model, e.restore, ["id": e.id]) ?? message }
                        picking.end()
                    }
                    Button(t("common.delete"), systemImage: "trash", role: .destructive) { purgingMany = true }
                }
            }
        }
        .confirmationDialog(t("trash.purge"), isPresented: $purgingMany) {
            Button(t("trash.purge"), role: .destructive) {
                let picked = (page?.entries ?? []).filter { picking.ids.contains($0.key) }
                for e in picked { message = change(model, e.purge, ["id": e.id]) ?? message }
                picking.end()
            }
        // Counted as purged: the picked rows still shown (a search or kind filter since may hide some).
        } message: { Text(t("trash.purgeConfirmMany", ["n": (page?.entries ?? []).filter { picking.ids.contains($0.key) }.count])) }
        .onAppear {
            // What has expired is purged on opening (PRES-R26); not asked for, so a refusal leaves the entries.
            if page?.expired == true { _ = model.app.mutate("purgeExpiredTrash", ["now": opened]) }
        }
        .confirmationDialog(t("trash.purge"), isPresented: Binding(get: { purging != nil }, set: { if !$0 { purging = nil } }), presenting: purging) { e in
            Button(t("trash.purge"), role: .destructive) { message = change(model, e.purge, ["id": e.id]) }
        } message: { e in Text(t("trash.purgeConfirm.\(e.kind)", ["name": e.name])) }
        .confirmationDialog(t("trash.empty"), isPresented: $emptying) {
            Button(t("trash.purge"), role: .destructive) { message = change(model, "emptyTrash", [:]) }
        } message: { Text(t("trash.emptyConfirm", ["n": page?.total ?? 0])) }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button(t("common.close")) {} }
    }

    private func row(_ e: TrashEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon(e.kind)).foregroundStyle(.secondary).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.name).lineLimit(1)
                (Text([t("trash.one.\(e.kind)"), e.detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") + " · ")
                 + Text(days(e.daysLeft)).foregroundStyle(e.daysLeft <= 1 ? .red : .secondary))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            #if os(macOS)
            Button(t("common.restore")) { restore(e) }
            #endif
        }
        .contextMenu {
            Button(t("common.restore"), systemImage: "arrow.uturn.backward") { restore(e) }
            Button(t("trash.purge"), systemImage: "trash", role: .destructive) { purging = e }
        }
        .swipeActions(edge: .trailing) {
            Button(t("trash.purge"), role: .destructive) { purging = e }
            Button(t("common.restore")) { restore(e) }.tint(Color.sky)
        }
    }

    private func restore(_ e: TrashEntry) {
        // The row leaving the list says it is back, as a Mac's Finder says nothing more; a refusal is said.
        message = change(model, e.restore, ["id": e.id])
    }

    private func days(_ n: Int) -> String { n == 0 ? t("trash.soon") : n == 1 ? t("trash.oneDay") : t("trash.days", ["n": n]) }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "Presentation": "map"
        case "Template": "doc.text"
        case "Song": "music.note"
        case "Image": "photo"
        case "Audio": "speaker.wave.2"
        case "Video": "video"
        default: "play.rectangle"
        }
    }
}
