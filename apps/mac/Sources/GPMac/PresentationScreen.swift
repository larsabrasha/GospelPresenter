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
                .environment(\.wideLayout, geo.size.width >= Size.columns)
                .navigationTitle(p.name)
                .modifier(Subtitle(text: when(p)))
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbarTitleMenu { titleMenu(p) }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) { startStop(wide: geo.size.width >= Size.columns) }
                }
                .sheet(isPresented: $editing) { DetailsSheet(presentationId: p.id) }
                .sheet(item: Bindable(model).addingSong) { at in AddSongSheet(at: at) }
                .textPrompt(Bindable(model).prompt)
                .alert(t("live.end"), isPresented: $ending) {
                    Button(t("common.cancel"), role: .cancel) {}
                    Button(t("live.end"), role: .destructive) { model.live.press(model, ["type": "stop"]) }
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
                    case "editDetails": Button(t(a.text), systemImage: "pencil") { editing = true }
                    case "trash": Button(t(a.text), systemImage: "trash", role: .destructive) { trashing = true }
                    default: EmptyView()
                    }
                }
            }
        }
    }

    /// ▶ to start or ■ to end, which asks first; on a computer with its words, as the web's bar.
    @ViewBuilder
    private func startStop(wide: Bool) -> some View {
        if model.isLive {
            Button(role: .destructive) { ending = true } label: {
                Label(t("live.end"), systemImage: "stop.fill").labelStyle(Wide(wide: wide))
            }
            .buttonStyle(.borderedProminent).tint(.red)
            .keyboardShortcut(".", modifiers: .command)
        } else {
            Button { model.live.press(model, ["type": "start"]) } label: {
                Label(t("presentation.start"), systemImage: "play.fill").labelStyle(Wide(wide: wide))
            }
            .buttonStyle(.borderedProminent).tint(.green)
            .disabled(model.current?.items.allSatisfy(\.slides.isEmpty) ?? true)
        }
    }
}

/// A label with its words on a computer, the icon alone on a phone.
private struct Wide: LabelStyle {
    let wide: Bool
    func makeBody(configuration: Configuration) -> some View {
        if wide { Label { configuration.title } icon: { configuration.icon } } else { configuration.icon }
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
