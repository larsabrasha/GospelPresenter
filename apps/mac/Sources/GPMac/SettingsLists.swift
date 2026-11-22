// Etiketter, Överlägg and Teman (the web's Labels.tsx, Overlays.tsx, Themes.tsx; Utgångar in SettingsDisplays.swift):
// lists of the organisation's own, each change a mutation through the core. What a theme's menu offers is the core's
// (`themesPageView`), as are a new name (`freshNameView`) and a label's swatches (`labelColoursView`).
import Shell
import SwiftUI
import UniformTypeIdentifiers

/// A refusal or a result said in an alert, shared by the settings pages. Shown a moment after it is set: a message set
/// from a sheet's action, while that sheet is still closing, is otherwise never presented, and the alert's binding then
/// stays true so no later message shows either (the picture picker, the song import's duplicates, a new address).
struct RefusalAlert: ViewModifier {
    @Binding var message: String?
    @State private var shown: String?

    func body(content: Content) -> some View {
        content
            .alert(shown ?? "", isPresented: Binding(get: { shown != nil }, set: { if !$0 { shown = nil; message = nil } })) { Button(t("common.close")) {} }
            .onChange(of: message) { _, now in show(now) }
            .onAppear { show(message) }
            // Gone with the page: what waits to be shown is dropped, and one it could not present holds nothing back.
            .onDisappear { latest += 1; shown = nil }
    }

    /// Each show asked for, so only the latest acts (two of one text, onAppear and onChange together, a page gone).
    @State private var latest = 0

    /// After a sheet's closing (about a third of a second on iOS), unless another message took its place. A success
    /// since (`message` set back to nil by the next change) does not hide it. One on screen is closed first, and the
    /// new one shown once that has gone, so it is a new alert.
    private func show(_ text: String?) {
        guard let text else { return }
        latest += 1
        let mine = latest
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            // (No "already shown" check: a message set while it could not be presented stays in `shown` with no alert,
            // and the same refusal again must close and show it anew; one truly on screen keeps `message`, so no show.)
            guard mine == latest, message == text || message == nil else { return }
            if shown == nil { shown = text; return }
            shown = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { if mine == latest { shown = text } }
        }
    }
}

extension View {
    func refusal(_ message: Binding<String?>) -> some View { modifier(RefusalAlert(message: message)) }
}

extension Model {
    /// A name for something new, the core's: `base`, else `base 2` … (`freshNameView`).
    func freshName(_ base: String, taken: [String]) -> String {
        view("freshNameView", ["base": base, "taken": taken], as: String.self) ?? base
    }
}

/// A `#rrggbb` colour as SwiftUI's.
func cssColor(_ css: String) -> Color {
    let v = UInt32(css.dropFirst(), radix: 16) ?? 0x6b7280
    return Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
}

// MARK: Etiketter

struct LabelRow: Decodable, Identifiable, Hashable { let id: String, text: String, color: String }

struct LabelsPage: View {
    @Environment(Model.self) private var model
    @State private var editing: LabelRow?
    @State private var adding = false
    @State private var message: String?
    /// Välj: the labels picked, the platform's own way (a list's selection; on iOS its edit mode, with drag handles).
    @State private var selected: Set<String> = []
    @State private var deleting: [LabelRow] = []
    #if os(iOS)
    @State private var mode: EditMode = .inactive
    #endif
    /// What the list can do, the core's (`libraryPageView`).
    private var lib: LibraryPage? { model.libraryPage("labels") }

    var body: some View {
        let labels = model.view("labelsView", as: [LabelRow].self) ?? []
        List(selection: $selected) {
            IntroCard(id: "labels")
            Section {
                ForEach(labels) { l in
                    let chip = Text(l.text).font(.callout.weight(.medium)).foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4).background(cssColor(l.color), in: Capsule())
                    #if os(macOS)
                    // A row of the list's selection, as Sånger's: a double click or ↵ opens it (libraryPicking below).
                    chip.tag(l.id)
                    #else
                    Button { editing = l } label: { chip }
                        .buttonStyle(.plain)
                        .tag(l.id)
                        .contextMenu { Button(t("labels.deleteOne"), systemImage: "trash", role: .destructive) { deleting = [l] } }
                    #endif
                }
                .onMove { from, to in
                    guard let i = from.first else { return }
                    message = change(model, "moveLabel", ["id": labels[i].id, "toIndex": to > i ? to - 1 : to])
                }
                .onDelete { at in deleting = at.map { labels[$0] } }
            }
        }
        .libraryPicking(Picking(ids: selected), open: { id in editing = labels.first { $0.id == id } },
                        remove: { deleting = labels.filter { selected.contains($0.id) } }) { ids in
            if ids.count == 1, let l = labels.first(where: { ids.contains($0.id) }) {
                Button(t("palette.open"), systemImage: "arrow.up.forward.square") { editing = l }
            }
            ActionButtons(actions: lib?.picked ?? []) { _ in deleting = labels.filter { ids.contains($0.id) } }
        }
        #if os(iOS)
        .environment(\.editMode, $mode)
        #endif
        .overlay { if labels.isEmpty { ContentUnavailableView(t("labels.empty"), systemImage: "tag") } }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if !selected.isEmpty {
                    ActionButtons(actions: lib?.picked ?? []) { _ in deleting = labels.filter { selected.contains($0.id) } }
                }
                #if os(iOS)
                if lib?.pick == true {
                    Button(t(mode.isEditing ? "library.done" : "library.select")) { mode = mode.isEditing ? .inactive : .active; selected = [] }
                }
                #endif
            }
        }
        .floatingAdd(lib, shown: selected.isEmpty) { adding = true }
        .confirmationDialog(t("labels.deleteOne"), isPresented: Binding(get: { !deleting.isEmpty }, set: { if !$0 { deleting = [] } })) {
            Button(t("common.delete"), role: .destructive) {
                for l in deleting { message = change(model, "deleteLabel", ["id": l.id]) ?? message }
                selected = []
            }
        } message: { Text(deleting.count == 1 ? t("labels.deleteConfirm", ["text": deleting[0].text]) : t("labels.deleteMany", ["n": deleting.count])) }
        .sheet(isPresented: $adding) { LabelSheet(label: nil) }
        .sheet(item: $editing) { l in LabelSheet(label: l) }
        .refusal($message)
    }
}

/// A label made or changed: its text, its colour among the swatches (or its own), and Radera for one that is there.
struct LabelSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let label: LabelRow?
    @State private var text = ""
    @State private var color = ""
    @State private var error: String?
    @State private var deleting = false
    @State private var created = false
    @FocusState private var typing: Bool
    private struct Colours: Decodable { let swatches: [String], chosen: String, maxLength: Int }

    var body: some View {
        // The swatches with this label's own colour where it is none of them, and the text's limit: the core's.
        let colours = model.view("labelColoursView", color.isEmpty ? [:] : ["color": color], as: Colours.self)
        let swatches = colours?.swatches ?? []
        let limit = colours?.maxLength ?? 50
        Form {
            // Shift+Enter, when creating, creates and empties the field for the next (SONG-A28), as the web's.
            #if os(iOS)
            if label == nil {
                ShiftReturnField(placeholder: t("labels.field"), text: $text, shiftReturn: createNext).limited($text, to: limit)
            } else {
                TextField(t("labels.field"), text: $text).limited($text, to: limit)
            }
            #else
            TextField(t("labels.field"), text: $text).limited($text, to: limit)
                .focused($typing)
                .onKeyPress(.return, phases: .down) { press in
                    guard label == nil, press.modifiers.contains(.shift) else { return .ignored }
                    createNext()
                    return .handled
                }
            #endif
            if created { Text(t("labels.created")).font(.caption).foregroundStyle(.secondary) }
            Section {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(32)), count: 6), spacing: 10) {
                    ForEach(swatches, id: \.self) { c in
                        Circle().fill(cssColor(c)).frame(width: 28, height: 28)
                            .overlay(Circle().stroke(Color.primary, lineWidth: c.lowercased() == color.lowercased() ? 2 : 0).padding(-3))
                            .onTapGesture { color = c }
                    }
                }
                ColorPicker(t("labels.otherColor"), selection: Binding(get: { cssColor(color) }, set: { color = hexOf($0) }), supportsOpacity: false)
            }
            if let error { Text(error).foregroundStyle(.red) }
            if let label {
                Button(t("labels.deleteOne"), role: .destructive) { deleting = true }
            }
        }
        .formStyle(.grouped)
        // Asked first, as the web asks: a label has no trash, and the songs' parts lose it.
        .confirmationDialog(t("labels.deleteOne"), isPresented: $deleting) {
            Button(t("labels.deleteOne"), role: .destructive) {
                if let label, let e = change(model, "deleteLabel", ["id": label.id]) { error = e } else { dismiss() }
            }
        } message: { Text(t("labels.deleteConfirm", ["text": label?.text ?? ""])) }
        .onAppear { text = label?.text ?? ""; color = model.view("labelColoursView", label.map { ["color": $0.color] } ?? [:], as: Colours.self)?.chosen ?? "#6b7280" }
        .sheetBar(t(label == nil ? "labels.addTitle" : "labels.editTitle"), disabled: text.trimmingCharacters(in: .whitespaces).isEmpty) {
            let args: [String: Any] = ["text": text.trimmingCharacters(in: .whitespaces), "color": color]
            error = label.map { change(model, "updateLabel", args.merging(["id": $0.id]) { a, _ in a }) } ?? change(model, "createLabel", args)
            return error == nil
        }
        .sheetSize(360, 320)
    }

    /// The label typed created, and the field emptied and kept for the next.
    private func createNext() {
        let name = text.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        error = change(model, "createLabel", ["text": name, "color": color])
        if error == nil { text = ""; created = true; typing = true }
    }

    private func hexOf(_ c: Color) -> String {
        #if os(macOS)
        let n = NSColor(c).usingColorSpace(.sRGB) ?? .gray
        let (r, g, b) = (n.redComponent, n.greenComponent, n.blueComponent)
        #else
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        #endif
        // Kept within 0…255: iOS's picker may give a wide-gamut colour outside 0…1, which is no #rrggbb.
        let byte = { (v: CGFloat) in min(255, max(0, Int((v * 255).rounded()))) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }
}

// MARK: Överlägg

struct OverlayEntry: Decodable, Identifiable, Hashable {
    let id: String, title: String, content: String?
    /// Its page, as the overlay keeps it (JSON text).
    var page: JSONValue? { content.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) } }
}

struct OverlaysPage: View {
    @Environment(Model.self) private var model
    @State private var prompt: TextPrompt?
    @State private var removing: OverlayEntry?
    @State private var openedOverlay: String?
    @State private var message: String?
    @State private var query = ""
    @State private var sort = ""
    @State private var picking = Picking()
    @State private var removingMany = false
    private struct Ordered: Decodable { struct Sort: Decodable, Hashable { let id: String, text: String }; let rows: [OverlayEntry], sorts: [Sort], sort: String }

    var body: some View {
        let ordered = model.view("libraryOrderView", ["kind": "overlays", "query": query, "sort": sort, "locale": Texts.language], as: Ordered.self)
        let overlays = ordered?.rows ?? []
        List(selection: listSelection($picking)) {
            IntroCard(id: "overlays")
            ForEach(overlays) { o in
                let label = HStack(spacing: 12) {
                    PagePreview(page: o.page).frame(width: 96, height: 54).clipShape(RoundedRectangle(cornerRadius: 4))
                    Text(o.title)
                }
                LibraryRow(picking: $picking, id: o.id, label: label) { label in
                    NavigationLink { SlideEditorPage(target: .overlay(o.id)) } label: { label }
                        .contextMenu { menu(o) }
                        .swipeActions { ActionButtons(actions: (lib?.row ?? []).filter(\.destructive)) { act($0, o) } }
                }
            }
        }
        .libraryPicking(picking, open: { openedOverlay = $0 }, remove: { removingMany = true }) { ids in
            if ids.count == 1, let o = overlays.first(where: { ids.contains($0.id) }) {
                Button(t("palette.open"), systemImage: "arrow.up.forward.square") { openedOverlay = o.id }
                menu(o)
            } else {
                ActionButtons(actions: lib?.picked ?? []) { _ in picking.ids = ids; removingMany = true }
            }
        }
        .overlay { if overlays.isEmpty, query.isEmpty { ContentUnavailableView(t("overlays.empty"), systemImage: "square.on.square") } }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .toolbar {
            if !picking.on {
                ToolbarItem(placement: .primaryAction) {
                    SortMenu(sorts: (ordered?.sorts ?? []).map { ($0.id, $0.text) }, selection: Binding(get: { ordered?.sort ?? "" }, set: { sort = $0 }))
                }
            }
            PickingToolbar(picking: $picking, shown: lib?.pick ?? false) { ActionButtons(actions: lib?.picked ?? []) { _ in removingMany = true } }
        }
        .floatingAdd(lib, shown: !picking.on) {
            let title = model.freshName(t("overlays.new"), taken: overlays.map(\.title))
            let id = UUID().uuidString.lowercased()
            message = change(model, "createOverlay", ["id": id, "title": title, "at": nowMs()])
            // Opened as it is made, as the web's.
            if message == nil { openedOverlay = id }
        }
        .confirmationDialog(t("common.delete"), isPresented: $removingMany) {
            Button(t("common.delete"), role: .destructive) {
                for id in picking.ids { message = change(model, "deleteOverlay", ["id": id]) ?? message }
                picking.end()
            }
        } message: { Text(t("overlays.removeMany", ["n": picking.ids.count])) }
        .textPrompt($prompt)
        .navigationDestination(item: $openedOverlay) { id in SlideEditorPage(target: .overlay(id)) }
        .confirmationDialog(t("common.delete"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { o in
            Button(t("common.delete"), role: .destructive) { message = change(model, "deleteOverlay", ["id": o.id]) }
        } message: { o in Text(t("overlays.removeConfirm", ["title": o.title])) }
        .refusal($message)
    }

    /// What the list can do, the core's (`libraryPageView`).
    private var lib: LibraryPage? { model.libraryPage("overlays") }

    private func menu(_ o: OverlayEntry) -> some View { ActionButtons(actions: lib?.row ?? []) { act($0, o) } }

    private func act(_ id: String, _ o: OverlayEntry) {
        switch id {
        case "rename": rename(o)
        case "delete": removing = o
        default: break
        }
    }

    private func rename(_ o: OverlayEntry) {
        prompt = TextPrompt(title: t("library.renameTitle"), label: t("displays.name"), text: o.title, rule: FieldRule(required: true, max: 200)) { name in
            message = change(model, "updateOverlay", ["id": o.id, "title": name.trimmingCharacters(in: .whitespaces), "at": nowMs()])
        }
    }
}

// MARK: Teman

struct ThemesPageModel: Decodable {
    struct Action: Decodable, Hashable { let id: String, text: String, icon: String, destructive: Bool }
    struct Theme: Decodable, Identifiable, Hashable { let id: String, name: String?, nameKey: String?, descriptionKey: String?, builtIn: Bool, `default`: Bool, actions: [Action] }
    let themes: [Theme], canAdd: Bool
}

struct ThemesPage: View {
    @Environment(Model.self) private var model
    @State private var removing: ThemesPageModel.Theme?
    /// The own theme open in the editor; a new or duplicated one opens as it is made, as the web's.
    @State private var editing: String?
    @State private var message: String?
    @State private var picking = Picking()
    @State private var removingMany = false

    var body: some View {
        let page = model.view("themesPageView", ["role": model.role], as: ThemesPageModel.self)
        let themes = page?.themes ?? []
        List(selection: listSelection($picking)) {
            IntroCard(id: "themes")
            ForEach(themes) { theme in
                let row = HStack {
                    ThemePreview(id: theme.id).frame(width: 96, height: 54).clipShape(RoundedRectangle(cornerRadius: 4))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name(theme))
                        if let d = theme.descriptionKey { Text(t(d)).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    if theme.default { Text(t("themes.default")).font(.caption.weight(.semibold)).foregroundStyle(Color.sky) }
                    if !theme.actions.isEmpty {
                        Menu { menu(theme) } label: { Image(systemName: "ellipsis.circle") }.menuIndicator(.hidden).fixedSize()
                    }
                }
                #if os(macOS)
                row.tag(theme.id)
                #else
                // Välj takes the own themes only, as the web's: a built-in one is never deleted.
                if picking.on, deletable(theme) {
                    PickRow(picking: $picking, id: theme.id) { Text(name(theme)) }
                } else {
                    row.contextMenu { menu(theme) }
                        // A tap on an own theme opens it, as the web's tile.
                        .contentShape(Rectangle())
                        .onTapGesture { if editable(theme) { editing = theme.id } }
                }
                #endif
            }
        }
        // On a Mac: a double click opens an own theme, ⌫ and the menu remove the own ones picked (never a built-in).
        .libraryPicking(picking, open: { id in if themes.first(where: { $0.id == id }).map(editable) == true { editing = id } },
                        remove: { if themes.contains(where: { picking.ids.contains($0.id) && deletable($0) }) { removingMany = true } }) { ids in
            if ids.count == 1, let theme = themes.first(where: { ids.contains($0.id) }) {
                menu(theme)
            } else if themes.contains(where: { ids.contains($0.id) && deletable($0) }) {
                ActionButtons(actions: lib?.picked ?? []) { _ in picking.ids = ids; removingMany = true }
            }
        }
        .navigationDestination(item: $editing) { id in ThemeEditorPage(id: id) }
        .floatingAdd(lib, shown: !picking.on) { copy(from: nil, name: t("themes.new")) }
        .toolbar {
            PickingToolbar(picking: $picking, shown: lib?.pick ?? false) { ActionButtons(actions: lib?.picked ?? []) { _ in removingMany = true } }
        }
        .confirmationDialog(t("themes.delete"), isPresented: $removingMany) {
            Button(t("themes.delete"), role: .destructive) {
                for th in themes where picking.ids.contains(th.id) && deletable(th) { message = change(model, "deleteTheme", ["id": th.id]) ?? message }
                picking.end()
            }
        } message: { Text(t("themes.deleteMany", ["n": themes.filter { picking.ids.contains($0.id) && deletable($0) }.count])) }
        .confirmationDialog(t("themes.delete"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { th in
            Button(t("themes.delete"), role: .destructive) { message = change(model, "deleteTheme", ["id": th.id]) }
        } message: { th in Text(t("themes.deleteAsk", ["name": name(th)])) }
        .refusal($message)
    }

    private func name(_ theme: ThemesPageModel.Theme) -> String { theme.nameKey.map { t($0) } ?? theme.name ?? "" }
    /// What the list can do, the core's (`libraryPageView`): + and the actions for the picked; each theme's menu is
    /// `themesPageView`'s, as it differs by theme.
    private var lib: LibraryPage? { model.libraryPage("themes") }
    /// An own theme, which the core lets this role edit or delete; a built-in one never.
    private func editable(_ theme: ThemesPageModel.Theme) -> Bool { theme.actions.contains { $0.id == "edit" } }
    private func deletable(_ theme: ThemesPageModel.Theme) -> Bool { theme.actions.contains { $0.id == "delete" } }
}

/// A theme drawn on the theme editor's song sample, as its tile on the web shows it.
struct ThemePreview: View {
    @Environment(Model.self) private var model
    let id: String

    var body: some View {
        let theme = model.view("themeView", ["id": id], as: JSONValue.self)
        let sample = theme.flatMap { model.view("themeEditorView", ["definition": $0["definition"]?.any ?? NSNull(), "kind": "song"], as: JSONValue.self)?["sample"] }
        LiveSlide(tile: TileRequest(slide: sample, theme: theme, overlay: nil, label: false, media: model.app.mediaGeneration)).allowsHitTesting(false)
    }
}

extension ThemesPage {

    @ViewBuilder private func menu(_ theme: ThemesPageModel.Theme) -> some View {
        ForEach(theme.actions, id: \.self) { a in
            Button(t(a.text), systemImage: Look.symbol(a.icon), role: a.destructive ? .destructive : nil) {
                switch a.id {
                case "edit": editing = theme.id
                case "default": message = change(model, "setDefaultTheme", ["themeId": theme.id])
                case "duplicate": copy(from: theme.id, name: t("themes.copyName", ["name": name(theme)]))
                case "delete": removing = theme
                default: break
                }
            }
        }
    }

    /// A new theme with the look of `from` (nil: the default's), as + and Duplicera make one.
    private func copy(from id: String?, name: String) {
        let theme = model.view("themeView", ["id": id.map { $0 as Any } ?? NSNull()], as: JSONValue.self)
        guard let definition = theme?["definition"]?.any else { return }
        let new = UUID().uuidString.lowercased()
        message = change(model, "createTheme", ["id": new, "name": name, "definition": definition, "at": nowMs()])
        if message == nil { editing = new }
    }
}
