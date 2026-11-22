// The start page (docs/layout-2-0.md, "The start page and the bar"; apps/web/src/pages/Presentations.tsx): what this
// device presents at the top, then Idag, Kommande and Senast ändrade, each row two lines at every width, its number of
// items at the right; + to make a presentation; the user's picture and its menu in the bar.
import Shell
import SwiftUI

struct StartPage: View {
    @Environment(Model.self) private var model
    @State private var creating = false
    /// Senast ändrade shows 20 at a time, with Visa fler (Dashboard.razor's PageSize).
    @State private var restShown = 20
    /// The list stands in a readable column (`readableWidth`).
    @State private var wide = false

    var body: some View {
        page.sheet(isPresented: Bindable(model).templatesOpen) { TemplatesPage() }
    }

    @ViewBuilder private var page: some View {
        #if os(macOS)
        mac(today: localToday())
            // The window keeps its name (Window menu, Mission Control); the page's heading row says it on the page.
            .navigationTitle(t("nav.presentations"))
            .titleOnlyInWindow()
            // At the toolbar's far end, as the web's bar has it; without the title, a flexible space keeps it there.
            .toolbar { ToolbarItemGroup { Spacer(); AccountMenu() } }
            .sheet(isPresented: $creating) { CreateSheet() }
            // GP_MAC_CREATE: Skapa presentation open at the start, for pictures of it (GP_MAC_SNAPSHOT).
            .onAppear { if ProcessInfo.processInfo.environment["GP_MAC_CREATE"] != nil { creating = true } }
        #else
        list
        #endif
    }

    #if os(macOS)
    /// On a Mac the web's start page in the Mac's own parts (Lars, 2026-11-18: a Mac app should feel like one): the
    /// system's grouped list, as System Settings has it, its rows two lines and › from the system, in a column of the
    /// web's page width in the middle; over it, as on the web, the heading and + at its end, a Mac's own round
    /// prominent button. What the page holds and in what order is the web's (apps/web/src/pages/Presentations.tsx).
    private func mac(today: String) -> some View {
        Form {
            Section {} header: {
                HStack {
                    Text(t("nav.presentations")).font(.largeTitle.bold()).foregroundStyle(Color.primary)
                    Spacer()
                    Button { creating = true } label: { Image(systemName: "plus").font(.title3.weight(.semibold)) }
                        .role("add").buttonBorderShape(.circle).controlSize(.large)
                        .accessibilityLabel(t("presentations.new")).help(t("presentations.new"))
                }
                .padding(.bottom, 4)
            }
            if let id = model.live.id, let p = model.presentations.first(where: { $0.id == id }) {
                Section { NavigationLink(value: p.id) { NowShowing(p: p) } }
            }
            ForEach(model.lists) { list in
                let rows = list.id == "recent" ? Array(list.rows.prefix(restShown)) : list.rows
                if !rows.isEmpty {
                    Section(t(list.title)) {
                        ForEach(rows) { p in
                            NavigationLink(value: p.id) {
                                PresentationListRow(p: p, subtitle: p.subtitle(today: today, showDate: list.showDate, withYear: list.withYear), live: p.id == model.live.id)
                                    .padding(.vertical, 4)
                            }
                        }
                        if rows.count < list.rows.count { Button(t("common.showMore")) { restShown += 20 }.buttonStyle(.link) }
                    }
                }
            }
        }
        .formStyle(.grouped)
        // The platform's grouped ground under the rows' cards (`lookView`'s `ground`), as System Settings has it.
        .scrollContentBackground(.hidden).background(Color.ground)
        .hardTopEdge()
        .readableWidth($wide)
        .overlay { if model.presentations.isEmpty { empty } }
    }
    #endif

    /// No presentation yet: what the page is for, and Skapa presentation.
    private var empty: some View {
        ContentUnavailableView {
            Label(t("presentations.emptyTitle"), systemImage: "rectangle.stack")
        } description: {
            Text(t("presentations.emptyText"))
        } actions: {
            Button(t("presentations.emptyNew")) { creating = true }.buttonStyle(.borderedProminent)
        }
    }

    /// On iOS the system's inset grouped list, in a readable column on a wide screen.
    private var list: some View {
        let today = localToday()
        return List {
            // Wide, the page's heading row stands over its column, + at its end, as the web's PageHeader: the system's
            // large title would stay at the screen's edge, away from the list.
            if wide {
                Section {} header: {
                    HStack {
                        // Color.primary, not the hierarchical .primary, which a section's heading tones down.
                        Text(t("nav.presentations")).font(.largeTitle.bold()).foregroundStyle(Color.primary)
                        Spacer()
                        AddButton(label: t("presentations.new")) { creating = true }.controlSize(.large)
                    }
                    .textCase(nil)
                    .padding(.horizontal, -20)
                }
            }
            if let id = model.live.id, let p = model.presentations.first(where: { $0.id == id }) {
                Section { NavigationLink(value: p.id) { NowShowing(p: p) } }
            }
            // The core's lists as they come (`startPageView`); Senast ändrade 20 at a time, the page's own paging.
            ForEach(model.lists) { list in
                let rows = list.id == "recent" ? Array(list.rows.prefix(restShown)) : list.rows
                section(list.title, rows, today: today, showDate: list.showDate, withYear: list.withYear)
                if rows.count < list.rows.count {
                    Section { Button(t("common.showMore")) { restShown += 20 }.frame(maxWidth: .infinity) }
                        .listRowBackground(Color.clear)
                }
            }
        }
        .page()
        .readableWidth($wide)
        .environment(\.defaultMinListRowHeight, Size.row)
        .navigationTitle(wide ? "" : t("nav.presentations"))
        #if os(iOS)
        .navigationBarTitleDisplayMode(wide ? .inline : .large)
        #endif
        .overlay { if model.presentations.isEmpty { empty } }
        .toolbar {
            // Wide, the user's picture at the bar's right as the web's; narrow, + there and the picture at the left.
            if wide {
                ToolbarItem(placement: .primaryAction) { AccountMenu() }
            } else {
                ToolbarItem(placement: .navigation) { AccountMenu() }
                ToolbarItem(placement: .primaryAction) { AddButton(label: t("presentations.new")) { creating = true } }
            }
        }
        .sheet(isPresented: $creating) { CreateSheet() }
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [PresentationRow], today: String, showDate: Bool, withYear: Bool) -> some View {
        if !rows.isEmpty {
            Section(t(title)) {
                ForEach(rows) { p in
                    NavigationLink(value: p.id) {
                        PresentationListRow(p: p, subtitle: p.subtitle(today: today, showDate: showDate, withYear: withYear), live: p.id == model.live.id)
                    }
                    .listRowBackground(Color.surface)
                }
            }
        }
    }
}

/// A row of the start page: the name, and under it when and where; the number of items at the right, and a small red
/// dot while it is the one shown (as Music marks what plays).
struct PresentationListRow: View {
    let p: PresentationRow
    let subtitle: String
    let live: Bool

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(.body).lineLimit(1)
                if !subtitle.isEmpty { Text(subtitle).font(.footnote).foregroundStyle(Color.quiet).lineLimit(1) }
            }
            Spacer(minLength: 8)
            if live { Circle().fill(.red).frame(width: 8, height: 8).accessibilityLabel(t("presentations.live")) }
            let n = p.itemCount ?? 0
            Text(n == 1 ? t("presentations.item") : t("presentations.items", ["n": n]))
                .font(.footnote).foregroundStyle(Color.quiet)
        }
    }
}

/// "Visas just nu": what this device presents, a card as the list's, red only in its pulsing dot and its first line.
private struct NowShowing: View {
    let p: PresentationRow
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label {
                Text(t("remote.nowShowing"))
            } icon: {
                Circle().fill(.red).frame(width: 8, height: 8).opacity(pulse ? 0.35 : 1)
                    .animation(.easeInOut(duration: 1).repeatForever(), value: pulse)
            }
            .font(.footnote.weight(.semibold)).foregroundStyle(.red)
            Text(p.name).font(.headline).lineLimit(1)
            let line = [p.time, p.location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !line.isEmpty { Text(line).font(.footnote).foregroundStyle(Color.quiet).lineLimit(1) }
        }
        .padding(.vertical, 4)
        .onAppear { pulse = true }
    }
}

/// The round + in a list's heading row, tinted in the app's blue (apps/web/src/ui/AddButton.tsx).
struct AddButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) { Image(systemName: "plus") }
            .role("add").buttonBorderShape(.circle)
            .accessibilityLabel(label).help(label)
    }
}

extension View {
    /// A page of the app: its list on the warm grey ground, the rows on their surface.
    func page() -> some View {
        #if os(iOS)
        self.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Color.ground)
        #else
        self.scrollContentBackground(.hidden).background(Color.ground)
        #endif
    }

    /// On a wide screen the page's list in a readable column in the middle, as the web's pages and Apple's Settings
    /// keep theirs; the whole width still scrolls it. A phone keeps the system's margins. `wide` says which it is.
    func readableWidth(_ wide: Binding<Bool>) -> some View { modifier(ReadableWidth(wide: wide)) }
}

private struct ReadableWidth: ViewModifier {
    @Binding var wide: Bool
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        let side = (width - Size.page) / 2
        Group {
            if side > 20 { content.contentMargins(.horizontal, side, for: .scrollContent) } else { content }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0; wide = (width - Size.page) / 2 > 20 }
    }
}
