// A presentation's one view, the same before and while it is presented (docs/layout-2-0.md, "Live"; the web's
// pages/presentation-editor/PresentationEditor.tsx): the bar with the way back to the start page, the title whose tap
// opens the presentation's menu, and ▶ or ■ at the far right; under it columns from about 1 000 pt wide, else one
// column with sheets.
import SwiftUI

struct PresentationScreen: View {
    @Environment(Model.self) private var model
    @State private var editing = false
    @State private var trashing = false
    @State private var ending = false

    var body: some View {
        GeometryReader { geo in
            if let p = model.current {
                Group {
                    if geo.size.width >= Size.columns { WideLayout(p: p) } else { PhoneLayout(p: p) }
                }
                .navigationTitle(p.name)
                .modifier(Subtitle(text: when(p)))
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbarTitleMenu { titleMenu(p) }
                .toolbar {
                    #if os(macOS)
                    // Not on a stack on a Mac (a split view of its own, GPMacApp's RootView): ‹ back to the start page.
                    ToolbarItem(placement: .navigation) {
                        Button { model.path = [] } label: { Label(t("nav.backToPresentations"), systemImage: Look.symbol("back")) }
                            .help(t("nav.backToPresentations")).keyboardShortcut("[", modifiers: .command)
                    }
                    #endif
                    #if os(iOS)
                    // Utgångar while an external display is connected: its output on or off by hand.
                    ToolbarItem(placement: .primaryAction) { ExternalOutputsMenu() }
                    #endif
                    ToolbarItem(placement: .primaryAction) { startStop(wide: geo.size.width >= Size.columns) }
                }
                .sheet(isPresented: $editing) { DetailsSheet(presentationId: p.id) }
                .sheet(item: Bindable(model).addingSong) { at in AddSongSheet(at: at) }
                // Markera on a phone: the running order ticked in a sheet; in columns it ticks in place.
                .sheet(isPresented: Binding(get: { model.ticking != nil && geo.size.width < Size.columns }, set: { if !$0 { model.ticking = nil } })) {
                    NavigationStack { TickList(p: p).navigationTitle(t("presentation.tick")) }
                }
                .textPrompt(Bindable(model).prompt)
                .alert(t("live.end"), isPresented: $ending) {
                    Button(t("common.cancel"), role: .cancel) {}
                    Button(t("live.end"), role: .destructive) { model.endPresenting() }
                } message: { Text(t("live.endText")) }
                .confirmationDialog(t("presentation.trash"), isPresented: $trashing, titleVisibility: .visible) {
                    Button(t("presentation.trash"), role: .destructive) {
                        if model.run("trashPresentation", ["id": p.id, "at": Int(Date().timeIntervalSince1970 * 1000)]) == "ok" { model.path = [] }
                    }
                } message: { Text(t("presentation.trashConfirm", ["name": p.name])) }
            } else {
                ContentUnavailableView(t("presentation.notFound"), systemImage: "questionmark.square.dashed")
            }
        }
        .background(Color.ground)
        .alert(model.refusal ?? "", isPresented: Binding(get: { model.refusal != nil }, set: { if !$0 { model.refusal = nil } })) {}
    }

    /// "sön 8 november · 11:00 · Kyrksalen" under the title; LIVE first while this device presents it.
    private func when(_ p: PresentationView) -> String {
        let parts = [p.eventDate.map { dateLabel($0, today: localToday(), withYear: false) }, p.time, p.location]
        let line = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return model.isLive ? ([t("live.badge")] + (line.isEmpty ? [] : [line])).joined(separator: " · ") : line
    }

    /// The presentation's menu, from a tap on its title: what it offers is the core's (`presentationActionsView`), the
    /// trash only when not presented. Not here yet, so left out: Material, Spara som mall.
    @ViewBuilder
    private func titleMenu(_ p: PresentationView) -> some View {
        let groups = model.view("presentationActionsView", ["isTemplate": false, "presenting": model.isLive, "role": model.role], as: MenuGroups.self)?.groups ?? []
        ForEach(groups, id: \.id) { group in
            Section {
                ForEach(group.actions, id: \.id) { a in
                    switch a.id {
                    case "editDetails": Button(t(a.text), systemImage: Look.symbol(a.icon)) { editing = true }
                    case "trash": Button(t(a.text), systemImage: Look.symbol(a.icon), role: .destructive) { trashing = true }
                    default: EmptyView()
                    }
                }
            }
        }
    }

    /// ▶ to start or ■ to end, which asks first; on a computer with its words, as the web's bar. Which, its text, its role
    /// and whether it may be pressed are the core's (`pageButtonsView`); its icon and key are this app's.
    @ViewBuilder
    private func startStop(wide: Bool) -> some View {
        let args: [String: Any] = ["place": "presentationBar", "presenting": model.isLive, "canStart": model.canStart,
                                   "hasSlides": !(model.current?.items.allSatisfy(\.slides.isEmpty) ?? true)]
        if let b = model.view("pageButtonsView", args, as: PageButtons.self)?.buttons.last {
            let ends = b.id == "end"
            Button { if ends { ending = true } else { model.send(["type": "start"]) } } label: {
                Label(t(b.text), systemImage: Look.symbol(b.icon)).labelStyle(Wide(wide: wide))
            }
            .role(b.role)
            .disabled(!b.enabled)
            // ⌘. ends, as before; starting has no key here yet.
            .keyboardShortcut(ends ? KeyboardShortcut(".", modifiers: .command) : nil)
            // "start" for the UI tests, as before.
            .accessibilityIdentifier(b.id)
        }
    }
}

/// A label with its words on a computer, the icon alone on a phone. The two side by side, not a Label again: in a Mac's
/// toolbar a Label is drawn as its icon alone.
private struct Wide: LabelStyle {
    let wide: Bool
    func makeBody(configuration: Configuration) -> some View {
        if wide { HStack(spacing: 6) { configuration.icon; configuration.title }.padding(.horizontal, 4) } else { configuration.icon }
    }
}

/// The line under the title: iOS 26's subtitle where there is one.
private struct Subtitle: ViewModifier {
    let text: String
    func body(content: Content) -> some View {
        if #available(iOS 26, macOS 26, *) { content.navigationSubtitle(text) } else { content }
    }
}

/// Where Lägg till puts what it adds: after an item, or at the end.
struct AddAt: Identifiable {
    let id = UUID()
    let after: String?
}

func icon(_ type: String) -> String {
    switch type {
    case "song": "music.note"
    case "header": "text.alignleft"
    case "video": "film"
    case "audio": "speaker.wave.2"
    case "image": "photo"
    case "bible": "book"
    default: "rectangle"
    }
}
