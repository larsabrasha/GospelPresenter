// The editor of a slideshow's pages and of an overlay's page (the web's custom-slides/SlideEditor.tsx, EditorCanvas.tsx,
// Inspector.tsx, PageNavigator.tsx), as the core lays it out (`slideEditorView`), picks on it (`slideHitView`) and
// changes it (`slideEditView`): the page painted as the outputs paint it, an element picked by a tap (the one beneath
// on the next), moved by dragging it and sized by its corner, the Format panel, the pages in a strip (new, copy,
// earlier, later, remove), Infoga, Ångra and Gör om over whole pages, each change saved as it is made.
import SwiftUI

enum EditedSlides: Hashable { case slideshow(String), overlay(String) }

struct SlideEditorModel: Decodable {
    struct Option: Decodable, Hashable { let id: String, text: String?, on: Bool? }
    struct Control: Decodable, Identifiable {
        let id: String, kind: String, text: String, value: JSONValue?, min: Int?, max: Int?, options: [Option]?, empty: String?, destructive: Bool?
    }
    struct Tab: Decodable, Hashable { let id: String, text: String }
    struct Layer: Decodable, Hashable { let id: String, kind: String, index: Int, text: String? }
    struct Insert: Decodable, Hashable { let id: String, text: String, icon: String }
    let element: JSONValue?, tabs: [Tab]?, tab: String?, controls: [Control], layers: [Layer]?, insert: [Insert], canAdd: Bool, canAddPage: Bool, canRemovePage: Bool, pages: Int
}

private struct Edited: Decodable { let pages: [JSONValue], page: Int, picked: String? }

struct SlideEditorPage: View {
    @Environment(Model.self) private var model
    let target: EditedSlides
    @State private var pages: [JSONValue] = []
    @State private var at = 0
    @State private var picked: String?
    @State private var tab: String?
    @State private var name = ""
    /// A field being typed in (the name, an element's text): ⌘X, ⌘C, ⌘V and ⌘Z are then the field's, not the page's.
    @FocusState private var typing: Bool
    /// How many times Ångra or Gör om has run: words typed before one are not saved after it.
    @State private var steps = 0
    @State private var past: [[JSONValue]] = []
    @State private var future: [[JSONValue]] = []
    @State private var choosing: String?
    @State private var drag: CGSize = .zero
    @State private var resize: CGSize = .zero
    @State private var missing = false
    /// An element cut or copied, to paste.
    @State private var clip: JSONValue?
    @State private var message: String?

    private var overlay: Bool { if case .overlay = target { true } else { false } }
    private var id: String { switch target { case let .slideshow(i), let .overlay(i): i } }

    private var editor: SlideEditorModel? {
        guard !pages.isEmpty else { return nil }
        var args: [String: Any] = ["pages": pages.map(\.any), "page": at, "overlay": overlay]
        if let picked { args["picked"] = picked }
        if let tab { args["tab"] = tab }
        return model.view("slideEditorView", args, as: SlideEditorModel.self)
    }

    var body: some View {
        let editor = editor
        Group {
            if let editor {
                #if os(macOS)
                HSplitView {
                    VStack(spacing: 0) { stage(editor); if !overlay { strip(editor) } }.frame(minWidth: 460)
                    inspector(editor).frame(minWidth: 300, idealWidth: 340, maxWidth: 420)
                }
                #else
                VStack(spacing: 0) { stage(editor); if !overlay { strip(editor) }; inspector(editor) }
                #endif
            } else if missing {
                ContentUnavailableView(t("slideEditor.missing"), systemImage: "play.rectangle")
            } else { ProgressView() }
        }
        .navigationTitle(name)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if let editor {
                    Menu {
                        ForEach(editor.insert, id: \.self) { k in
                            Button(t(k.text)) { if k.id == "image" { choosing = "add" } else { edit(["op": "add", "kind": k.id, "id": newId()]) } }
                        }
                    } label: { Label(t("slideEditor.add"), systemImage: "plus") }.disabled(!editor.canAdd)
                }
                // Klipp ut, Kopiera and Klistra in, as the web's element menu and its keys.
                Menu {
                    Button(t("slideEditor.cut"), systemImage: "scissors") { if let e = editor?.element { clip = e; edit(["op": "remove", "id": picked ?? ""]) } }
                        .disabled(editor?.element == nil).keyboardShortcut(key("x"))
                    Button(t("slideEditor.copy"), systemImage: "doc.on.doc") { clip = editor?.element }
                        .disabled(editor?.element == nil).keyboardShortcut(key("c"))
                    Button(t("slideEditor.paste"), systemImage: "doc.on.clipboard") { if let clip { edit(["op": "insert", "element": clip.any, "id": newId()]) } }
                        .disabled(clip == nil).keyboardShortcut(key("v"))
                } label: { Label(t("slideEditor.paste"), systemImage: "doc.on.clipboard") }
                Button(t("slideEditor.undo"), systemImage: "arrow.uturn.backward") { step(back: true) }.disabled(past.isEmpty).keyboardShortcut(key("z"))
                Button(t("slideEditor.redo"), systemImage: "arrow.uturn.forward") { step(back: false) }.disabled(future.isEmpty).keyboardShortcut(key("z", [.command, .shift]))
            }
        }
        .onAppear(perform: load)
        .sheet(item: Binding(get: { choosing.map { Choice(what: $0) } }, set: { choosing = $0?.what })) { c in
            PicturePickerSheet { p in chosen(c.what, p) }
        }
        .refusal($message)
    }

    private struct Choice: Identifiable { let what: String; var id: String { what } }
    private func newId() -> String { String(UUID().uuidString.lowercased().prefix(12)) }

    private func load() {
        switch target {
        case .slideshow:
            struct Row: Decodable { let name: String, pages: [JSONValue] }
            guard let row = model.view("customSlideView", ["id": id], as: Row.self) else { missing = true; return }
            name = row.name
            pages = row.pages
        case .overlay:
            struct Row: Decodable { let title: String, content: String? }
            guard let row = model.view("overlayRowView", ["id": id], as: Row.self) else { missing = true; return }
            name = row.title
            pages = [row.content.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) } ?? .object(["background": .null, "backgroundPicture": .null, "backgroundPage": .null, "elements": .array([])])]
        }
        if pages.isEmpty { missing = true }
    }

    // MARK: the stage

    private func stage(_ editor: SlideEditorModel) -> some View {
        GeometryReader { geo in
            let scale = min(geo.size.width / 1920, geo.size.height / 1080)
            let size = CGSize(width: 1920 * scale, height: 1080 * scale)
            ZStack(alignment: .topLeading) {
                LiveSlide(tile: TileRequest(slide: model.view("editorSlideView", ["page": pages[at].any], as: JSONValue.self), theme: model.view("themeView", ["id": NSNull()], as: JSONValue.self),
                                            overlay: nil, label: false, media: model.app.mediaGeneration))
                    .frame(width: size.width, height: size.height)
                if let e = editor.element, case let .number(x)? = e["x"], case let .number(y)? = e["y"], case let .number(w)? = e["w"], case let .number(h)? = e["h"] {
                    let box = CGRect(x: x * scale + drag.width, y: y * scale + drag.height, width: max(8, w * scale + resize.width), height: max(8, h * scale + resize.height))
                    Rectangle().stroke(Color.sky, lineWidth: 2).frame(width: box.width, height: box.height).offset(x: box.minX, y: box.minY).allowsHitTesting(false)
                    // The corner sizes it, as the web's handle.
                    Circle().fill(Color.sky).frame(width: 14, height: 14).offset(x: box.maxX - 7, y: box.maxY - 7)
                        .gesture(DragGesture()
                            .onChanged { resize = $0.translation }
                            .onEnded { g in
                                resize = .zero
                                changeElement(["w": max(20, w + g.translation.width / scale).rounded(), "h": max(e["kind"]?.string == "line" ? 0 : 20, h + g.translation.height / scale).rounded()])
                            })
                }
            }
            .frame(width: size.width, height: size.height)
            .contentShape(Rectangle())
            .onTapGesture { p in pick(CGPoint(x: p.x / scale, y: p.y / scale)) }
            .gesture(DragGesture(minimumDistance: 4)
                .onChanged { if editor.element != nil { drag = $0.translation } }
                .onEnded { g in
                    defer { drag = .zero }
                    guard let e = editor.element, case let .number(x)? = e["x"], case let .number(y)? = e["y"] else { return }
                    changeElement(["x": (x + g.translation.width / scale).rounded(), "y": (y + g.translation.height / scale).rounded()])
                })
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .padding()
    }

    private func pick(_ p: CGPoint) {
        var args: [String: Any] = ["page": pages[at].any, "x": p.x, "y": p.y]
        if let picked { args["picked"] = picked }
        picked = model.view("slideHitView", args, as: String?.self) ?? nil
        tab = nil
    }

    /// The pages as a strip: each a numbered tile to open, its menu, and + for a new page.
    private func strip(_ editor: SlideEditorModel) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(pages.indices, id: \.self) { i in
                    Button { at = i; picked = nil } label: {
                        Text(t("slideEditor.page", ["n": i + 1])).font(.caption).padding(.horizontal, 10).padding(.vertical, 6)
                            .background(i == at ? Color.sky.opacity(0.25) : Color.raised, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button(t("slideEditor.duplicatePage")) { at = i; addPage(copy: true) }.disabled(!editor.canAddPage)
                        Button(t("slideEditor.pageEarlier")) { at = i; edit(["op": "movePage", "to": i - 1]) }.disabled(i == 0)
                        Button(t("slideEditor.pageLater")) { at = i; edit(["op": "movePage", "to": i + 1]) }.disabled(i == pages.count - 1)
                        Button(t("slideEditor.removePage"), role: .destructive) { at = i; edit(["op": "removePage"]) }.disabled(!editor.canRemovePage)
                    }
                }
                Button(t("slideEditor.newPage"), systemImage: "plus") { addPage(copy: false) }.disabled(!editor.canAddPage)
            }
            .padding(.horizontal).padding(.bottom, 8)
        }
    }

    private func addPage(copy: Bool) {
        let count = pages[at]["elements"].flatMap { if case let .array(a) = $0 { a.count } else { nil } } ?? 0
        edit(["op": "addPage", "copy": copy, "ids": (0..<count).map { _ in newId() }])
    }

    // MARK: the inspector

    private func inspector(_ editor: SlideEditorModel) -> some View {
        Form {
            if editor.element == nil {
                Section {
                    TextField(t("song.name"), text: $name).limited($name, to: 200)
                        .savedWhenLeft($typing, value: name) { rename() }
                }
            } else if let tabs = editor.tabs {
                Picker(t("slideEditor.format"), selection: Binding(get: { editor.tab ?? "" }, set: { tab = $0 })) {
                    ForEach(tabs, id: \.self) { t_ in Text(t(t_.text)).tag(t_.id) }
                }
                .pickerStyle(.segmented).labelsHidden()
            }
            Section {
                ForEach(editor.controls) { c in control(c) }
            }
            if let layers = editor.layers, !layers.isEmpty {
                Section(t("slideEditor.layers")) {
                    ForEach(layers, id: \.self) { l in
                        Button { picked = l.id } label: {
                            Label(l.text.map { String($0.prefix(30)) } ?? t("slideEditor.\(l.kind == "rect" ? "rect" : l.kind)"), systemImage: l.id == picked ? "checkmark.circle.fill" : "circle")
                        }
                    }
                    .onMove { from, to in
                        // The list is the top first; the core's drawing order the bottom first.
                        guard let i = from.first else { return }
                        let n = layers.count, src = layers[i].index, dest = n - 1 - (to > i ? to - 1 : to)
                        if src != dest { edit(["op": "moveLayer", "from": src, "to": dest]) }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder private func control(_ c: SlideEditorModel.Control) -> some View {
        switch c.kind {
        case "textArea":
            // Saved to the element and page it was typed on, though another is picked or shown by the time it saves.
            let (element, page, made) = (picked ?? "", at, steps)
            TextAreaControl(text: c.value?.string ?? "", label: t(c.text), typing: $typing) { saveText($0, element: element, page: page, made: made) }.id(picked)
        case "slider":
            let v: Double = { if case let .number(n)? = c.value { n } else { 0 } }()
            LabeledContent(t(c.text)) {
                Slider(value: Binding(get: { v }, set: { changeElement([c.id: $0.rounded()]) }), in: Double(c.min ?? 0)...Double(c.max ?? 100), step: 1)
                Text("\(Int(v))").monospacedDigit().frame(width: 36, alignment: .trailing)
            }
        case "switches":
            ForEach(c.options ?? [], id: \.self) { o in Toggle(t(o.text ?? ""), isOn: Binding(get: { o.on ?? false }, set: { changeElement([o.id: $0]) })) }
        case "segments":
            Picker(t(c.text), selection: Binding(get: { c.value?.string ?? "" }, set: { changeElement([c.id: $0]) })) {
                ForEach(c.options ?? [], id: \.self) { o in Text(t(o.text ?? "")).tag(o.id) }
            }
            .pickerStyle(.segmented)
        case "color":
            // Empty is the theme's colour, or none: a switch beside the well, as the web's ColorChoice.
            let set = c.value?.string
            LabeledContent(t(c.text)) {
                Toggle(t(c.empty == "theme" ? "slideEditor.theme" : "slideEditor.none"), isOn: Binding(get: { set == nil }, set: { empty in
                    let v: Any = empty ? NSNull() : "#ffffff"
                    c.id == "background" ? page(["background": v]) : changeElement([c.id: v])
                }))
                .toggleStyle(.button)
                if let set {
                    ColorPicker("", selection: Binding(get: { cssColor(set) }, set: { v in c.id == "background" ? page(["background": hexString(v)]) : changeElement([c.id: hexString(v)]) }), supportsOpacity: false)
                        .labelsHidden()
                }
            }
        case "action":
            Button(t(c.text), role: c.destructive == true ? .destructive : nil) { act(c.id) }
        default:
            EmptyView()
        }
    }

    private func act(_ id: String) {
        guard let picked else {
            switch id {
            case "backgroundPicture": choosing = "background"
            case "removeBackgroundPicture": page(["backgroundPicture": NSNull()])
            case "removeBackgroundPage": page(["backgroundPage": NSNull()])
            default: break
            }
            return
        }
        switch id {
        case "top", "bottom": edit(["op": "reorder", "id": picked, "to": id])
        case "duplicate": edit(["op": "duplicate", "id": picked, "newId": newId()])
        case "remove": edit(["op": "remove", "id": picked])
        case "replaceImage": choosing = "replace"
        default: break
        }
    }

    private func chosen(_ what: String, _ p: ChosenPicture) {
        let picture: [String: Any] = ["full": p.full, "thumb": p.thumb]
        switch what {
        case "add": edit(["op": "add", "kind": "image", "id": newId(), "picture": picture.merging(["width": p.width, "height": p.height]) { a, _ in a }])
        case "replace": changeElement(["picture": picture])
        default: page(["backgroundPicture": picture])
        }
    }

    // MARK: changes

    /// The page's key, none while a field is typed in (a toolbar button's key goes before the field's own).
    private func key(_ k: Character, _ modifiers: EventModifiers = .command) -> KeyboardShortcut? {
        typing ? nil : KeyboardShortcut(KeyEquivalent(k), modifiers: modifiers)
    }

    private func changeElement(_ patch: [String: Any]) {
        guard let picked else { return }
        edit(["op": "change", "id": picked, "patch": patch])
    }

    private func page(_ patch: [String: Any]) { edit(["op": "background", "patch": patch]) }

    /// One change, as the core makes it (`slideEditView`), kept for Ångra and saved.
    private func edit(_ op: [String: Any]) {
        var args = op.merging(["pages": pages.map(\.any), "page": at, "overlay": overlay]) { a, _ in a }
        if let picked { args["picked"] = picked }
        guard let r = model.view("slideEditView", args, as: Edited.self) else { return message = t("common.saveFailed") }
        at = r.page
        picked = r.picked
        guard r.pages != pages else { return }
        commit(r.pages)
    }

    /// New pages kept for Ångra and saved; refused (a limit, a picture not on the server), the pages and their history
    /// as they were.
    private func commit(_ next: [JSONValue]) {
        let (was, before, after) = (pages, past, future)
        past.append(pages)
        future = []
        if !save(next) { (pages, past, future) = (was, before, after) }
    }

    /// An element's words, typed on `page`, kept without moving what is shown or picked now. Dropped when Ångra or Gör
    /// om came since it was typed (`made`: it would undo the undo), or when the element is gone (cut, removed).
    private func saveText(_ text: String, element: String, page: Int, made: Int) {
        guard made == steps else { return }
        let args: [String: Any] = ["op": "change", "id": element, "patch": ["text": text], "pages": pages.map(\.any), "page": page, "overlay": overlay, "picked": element]
        guard let r = model.view("slideEditView", args, as: Edited.self), r.pages != pages else { return }
        commit(r.pages)
    }

    private func step(back: Bool) {
        let (was, before, after) = (pages, past, future)
        guard let next = back ? past.popLast() : future.popLast() else { return }
        steps += 1
        if back { future.append(pages) } else { past.append(pages) }
        at = min(at, next.count - 1)
        picked = nil
        if !save(next) { (pages, past, future) = (was, before, after) }
    }

    /// The pages kept and saved; false, with the refusal said, when the core refused them.
    private func save(_ next: [JSONValue]) -> Bool {
        pages = next
        switch target {
        case .slideshow: message = change(model, "updateCustomSlide", ["id": id, "pages": next.map(\.any), "at": nowMs()])
        case .overlay: message = change(model, "updateOverlay", ["id": id, "page": next[0].any, "at": nowMs()])
        }
        return message == nil
    }

    private func rename() {
        let v = name.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        switch target {
        case .slideshow: message = change(model, "updateCustomSlide", ["id": id, "name": v, "at": nowMs()])
        case .overlay: message = change(model, "updateOverlay", ["id": id, "title": v, "at": nowMs()])
        }
    }
}

/// A text element's words, saved half a second after the last key as the web's textarea is.
/// What is typed when the element stops being edited (another picked) is saved then, not lost.
struct TextAreaControl: View {
    let text: String, label: String
    var typing: FocusState<Bool>.Binding
    let save: (String) -> Void
    @State private var draft = ""

    var body: some View {
        TextEditor(text: $draft).frame(minHeight: 80).accessibilityLabel(label)
            .focused(typing)
            .onAppear { draft = text }
            .onChange(of: draft) { _, v in
                let now = v
                Task { try? await Task.sleep(for: .milliseconds(500)); if draft == now, now != text { save(now) } }
            }
            .onDisappear { if draft != text { save(draft) } }
    }
}
