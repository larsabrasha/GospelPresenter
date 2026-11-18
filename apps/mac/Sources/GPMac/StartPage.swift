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
        let today = localToday()
        let groups = model.groups
        List {
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
            section("presentations.today", groups.today, today: today, showDate: false, withYear: false)
            section("presentations.upcoming", groups.upcoming, today: today, showDate: true, withYear: false)
            section("presentations.recent", Array(groups.rest.prefix(restShown)), today: today, showDate: true, withYear: true)
            if groups.rest.count > restShown {
                Section { Button(t("common.showMore")) { restShown += 20 }.frame(maxWidth: .infinity) }
                    .listRowBackground(Color.clear)
            }
        }
        .page()
        .readableWidth($wide)
        .environment(\.defaultMinListRowHeight, Size.row)
        .navigationTitle(wide ? "" : t("nav.presentations"))
        #if os(iOS)
        .navigationBarTitleDisplayMode(wide ? .inline : .large)
        #endif
        .overlay {
            if model.presentations.isEmpty {
                ContentUnavailableView {
                    Label(t("presentations.emptyTitle"), systemImage: "rectangle.stack")
                } description: {
                    Text(t("presentations.emptyText"))
                } actions: {
                    Button(t("presentations.emptyNew")) { creating = true }.buttonStyle(.borderedProminent)
                }
            }
        }
        .toolbar {
            // Wide, the user's picture at the bar's right as the web's; narrow, + there and the picture at the left.
            if wide {
                ToolbarItem(placement: .primaryAction) { AccountMenu() }
            } else {
                ToolbarItem(placement: .navigation) { AccountMenu() }
                ToolbarItem(placement: .primaryAction) { AddButton(label: t("presentations.new")) { creating = true } }
            }
        }
        .sheet(isPresented: $creating) { DetailsSheet(presentationId: nil) }
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
            Text(p.itemCount == 1 ? t("presentations.item") : t("presentations.items", ["n": p.itemCount]))
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
        Button(action: action) { Image(systemName: "plus").foregroundStyle(.white) }
            .buttonStyle(.borderedProminent).buttonBorderShape(.circle).tint(.sky)
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
