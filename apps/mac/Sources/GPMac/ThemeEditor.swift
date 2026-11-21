// The theme editor (the web's theme-editor/ThemeEditor.tsx, ThemeCanvas.tsx, ThemeInspector.tsx), as the core lays it
// out (`themeEditorView`) and changes it (`themeEditView`): the kinds to show the theme on, the sample slide painted
// from the core's layout as the outputs paint it, the main text or the credits picked by a tap on the stage and moved
// by dragging, the Format panel's controls, Ångra and Gör om over whole definitions, each change saved
// (`updateTheme`) as it is made.
import SwiftUI

struct ThemeEditorModel: Decodable {
    struct Option: Decodable, Hashable { let id: String, text: String?, name: String?, on: Bool? }
    struct Control: Decodable, Identifiable {
        let id: String, kind: String, text: String, value: JSONValue?, min: Int?, max: Int?, options: [Option]?, alphaText: String?
    }
    struct Title: Decodable { let text: String, kind: String? }
    struct Group: Decodable { let title: JSONValue?, controls: [Control] }
    struct Kind: Decodable, Hashable { let id: String, text: String }
    struct Area: Decodable { let x, y, w, h: Double }
    let kinds: [Kind], sample: JSONValue, groups: [Group], hint: String?, area: Area?
}

struct ThemeEditorPage: View {
    @Environment(Model.self) private var model
    let id: String
    @State private var definition: JSONValue?
    @State private var name = ""
    /// The name field being typed in: ⌘Z is then the field's, not the definition's.
    @FocusState private var naming: Bool
    @State private var kind = "song"
    @State private var picked: String?
    @State private var past: [JSONValue] = []
    @State private var future: [JSONValue] = []
    @State private var choosingPicture = false
    @State private var drag: CGSize = .zero
    @State private var resize: CGSize = .zero
    @State private var message: String?

    private struct Own: Decodable { struct Theme: Decodable { let id: String, name: String, definition: JSONValue }; let theme: Theme }

    private var editor: ThemeEditorModel? {
        guard let definition else { return nil }
        var args: [String: Any] = ["definition": definition.any, "kind": kind]
        if let picked { args["picked"] = picked }
        return model.view("themeEditorView", args, as: ThemeEditorModel.self)
    }

    var body: some View {
        let editor = editor
        Group {
            if let editor {
                #if os(macOS)
                HSplitView {
                    stage(editor).frame(minWidth: 420)
                    inspector(editor).frame(minWidth: 300, idealWidth: 340, maxWidth: 420)
                }
                #else
                VStack(spacing: 0) {
                    stage(editor)
                    inspector(editor)
                }
                #endif
            } else {
                ContentUnavailableView(t("themeEditor.missing"), systemImage: "textformat")
            }
        }
        .navigationTitle(name)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button(t("slideEditor.undo"), systemImage: "arrow.uturn.backward") { step(back: true) }.disabled(past.isEmpty)
                    .keyboardShortcut(naming ? nil : KeyboardShortcut("z", modifiers: .command))
                Button(t("slideEditor.redo"), systemImage: "arrow.uturn.forward") { step(back: false) }.disabled(future.isEmpty)
                    .keyboardShortcut(naming ? nil : KeyboardShortcut("z", modifiers: [.command, .shift]))
            }
        }
        .onAppear(perform: load)
        .sheet(isPresented: $choosingPicture) {
            PicturePickerSheet { p in apply("image", ["kind": "picture", "full": p.full, "thumb": p.thumb]) }
        }
        .refusal($message)
    }

    /// The theme's name as kept, so leaving the field unchanged saves nothing.
    private var stored: String? { model.view("ownThemeView", ["id": id], as: Own.self)?.theme.name }

    private func load() {
        guard let own = model.view("ownThemeView", ["id": id], as: Own.self) else { return }
        definition = own.theme.definition
        name = own.theme.name
    }

    // MARK: the stage

    @ViewBuilder private func stage(_ editor: ThemeEditorModel) -> some View {
        VStack(spacing: 12) {
            Picker(t("themeEditor.kinds"), selection: Binding(get: { kind }, set: { kind = $0; picked = nil })) {
                ForEach(editor.kinds, id: \.self) { k in Text(t(k.text)).tag(k.id) }
            }
            .pickerStyle(.segmented).labelsHidden()
            GeometryReader { geo in
                let scale = min(geo.size.width / 1920, geo.size.height / 1080)
                let size = CGSize(width: 1920 * scale, height: 1080 * scale)
                ZStack(alignment: .topLeading) {
                    LiveSlide(tile: TileRequest(slide: editor.sample, theme: theme, overlay: nil, label: false, media: model.app.mediaGeneration))
                        .frame(width: size.width, height: size.height)
                    if let a = editor.area {
                        Rectangle().stroke(Color.sky, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                            .frame(width: max(8, a.w * scale + resize.width), height: max(8, a.h * scale + resize.height))
                            .offset(x: a.x * scale + drag.width, y: a.y * scale + drag.height)
                            .allowsHitTesting(false)
                        // The box sized by its corner, as the web's handles size it; the core keeps it on the stage.
                        Circle().fill(Color.sky).frame(width: 14, height: 14)
                            .offset(x: (a.x + a.w) * scale + resize.width - 7, y: (a.y + a.h) * scale + resize.height - 7)
                            .gesture(DragGesture()
                                .onChanged { resize = $0.translation }
                                .onEnded { g in
                                    resize = .zero
                                    apply("area", ["x": a.x, "y": a.y, "w": a.w + g.translation.width / scale, "h": a.h + g.translation.height / scale])
                                })
                    }
                }
                .frame(width: size.width, height: size.height)
                .contentShape(Rectangle())
                // A tap picks what it lands on, the main text or the credits; a tap beside them the background.
                .onTapGesture { p in pick(at: CGPoint(x: p.x / scale, y: p.y / scale)) }
                .gesture(DragGesture(minimumDistance: 4)
                    .onChanged { g in if editor.area != nil { drag = g.translation } }
                    .onEnded { g in
                        defer { drag = .zero }
                        guard let a = editor.area else { return }
                        apply("area", ["x": a.x + g.translation.width / scale, "y": a.y + g.translation.height / scale, "w": a.w, "h": a.h])
                    })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            if let hint = editor.hint { Text(t(hint)).font(.caption).foregroundStyle(.secondary) }
        }
        .padding()
    }

    /// The theme as SlideView and the painter take it.
    private var theme: JSONValue? {
        guard let definition else { return nil }
        return .object(["id": .string(id), "name": .string(name), "description": .string(""), "sort": .number(0), "definition": definition])
    }

    private func pick(at p: CGPoint) {
        guard kind != "media", case let .object(d)? = definition, case let .object(k)? = d[kind] else { return }
        let hit = { (role: String) -> Bool in
            guard let a = k[role]?["area"], case let .number(x)? = a["x"], case let .number(y)? = a["y"], case let .number(w)? = a["w"], case let .number(h)? = a["h"] else { return false }
            return CGRect(x: x, y: y, width: w, height: h).contains(p)
        }
        picked = hit("credits") ? "credits" : hit("main") ? "main" : nil
    }

    // MARK: the inspector

    private func inspector(_ editor: ThemeEditorModel) -> some View {
        Form {
            if picked == nil {
                Section {
                    TextField(t("song.name"), text: $name).limited($name, to: 100)
                        .savedWhenLeft($naming, value: name) { let v = name.trimmingCharacters(in: .whitespaces); if !v.isEmpty, v != stored { message = change(model, "updateTheme", ["id": id, "name": v, "at": nowMs()]) } }
                }
            } else {
                Section { Button(t("themeEditor.backgroundOf", ["kind": t("themeEditor.\(kind)").lowercased()]), systemImage: "chevron.left") { picked = nil } }
            }
            ForEach(Array(editor.groups.enumerated()), id: \.offset) { _, g in
                Section {
                    ForEach(g.controls) { c in control(c) }
                } header: { title(g.title).map(Text.init) }
            }
        }
        .formStyle(.grouped)
    }

    private func title(_ v: JSONValue?) -> String? {
        if let s = v?.string { return t(s) }
        if let text = v?["text"]?.string { return t(text, ["kind": t(v?["kind"]?.string ?? "").lowercased()]) }
        return nil
    }

    @ViewBuilder private func control(_ c: ThemeEditorModel.Control) -> some View {
        switch c.kind {
        case "slider":
            let value = number(c.value)
            LabeledContent(t(c.text)) {
                Slider(value: Binding(get: { value }, set: { apply(c.id, Int($0.rounded())) }), in: Double(c.min ?? 0)...Double(c.max ?? 100), step: 1)
                Text(c.id == "lineHeight" ? String(format: "%.1f", value / 10) : "\(Int(value))").monospacedDigit().frame(width: 36, alignment: .trailing)
            }
        case "segments":
            Picker(t(c.text), selection: Binding(get: { c.value?.string ?? "" }, set: { apply(c.id, $0) })) {
                ForEach(c.options ?? [], id: \.self) { o in Text(t(o.text ?? "")).tag(o.id) }
            }
            .pickerStyle(.segmented)
        case "picker":
            Picker(t(c.text), selection: Binding(get: { c.value?.string ?? "" }, set: { apply(c.id, $0) })) {
                ForEach(c.options ?? [], id: \.self) { o in Text(o.name ?? "").tag(o.id) }
            }
        case "color":
            ColorPicker(t(c.text), selection: Binding(get: { cssColor(c.value?.string ?? "#000000") }, set: { apply(c.id, hexString($0)) }), supportsOpacity: false)
        case "colorAlpha":
            let hex = c.value?["hex"]?.string ?? "#ffffff", alpha = number(c.value?["alpha"])
            ColorPicker(t(c.text), selection: Binding(get: { cssColor(hex) }, set: { apply(c.id, ["hex": hexString($0), "alpha": Int(alpha)]) }), supportsOpacity: false)
            LabeledContent(t(c.alphaText ?? "")) {
                Slider(value: Binding(get: { alpha }, set: { apply(c.id, ["hex": hex, "alpha": Int($0.rounded())]) }), in: Double(c.min ?? 10)...100, step: 1)
                Text("\(Int(alpha)) %").monospacedDigit().frame(width: 44, alignment: .trailing)
            }
        case "switches":
            ForEach(c.options ?? [], id: \.self) { o in
                Toggle(t(o.text ?? ""), isOn: Binding(get: { o.on ?? false }, set: { apply(o.id, $0) }))
            }
        case "picture":
            Button(t(c.text)) { choosingPicture = true }
        case "action":
            Button(t(c.text), role: c.id == "removeImage" ? .destructive : nil) { apply(c.id, NSNull()) }
        default:
            EmptyView()
        }
    }

    private func number(_ v: JSONValue?) -> Double { if case let .number(n)? = v { n } else { 0 } }

    // MARK: changes

    /// One control's change, as the core makes it (`themeEditView`), kept for Ångra and saved.
    private func apply(_ control: String, _ value: Any) {
        guard let definition else { return }
        var args: [String: Any] = ["definition": definition.any, "kind": kind, "id": control, "value": value]
        if let picked { args["picked"] = picked }
        guard let next = model.view("themeEditView", args, as: JSONValue.self) else { return message = t("common.saveFailed") }
        guard next != definition else { return }
        past.append(definition)
        future = []
        save(next)
    }

    private func step(back: Bool) {
        guard let definition, let next = back ? past.popLast() : future.popLast() else { return }
        if back { future.append(definition) } else { past.append(definition) }
        save(next)
    }

    private func save(_ next: JSONValue) {
        definition = next
        message = change(model, "updateTheme", ["id": id, "definition": next.any, "at": nowMs()])
    }
}

/// A colour as `#rrggbb`.
func hexString(_ c: Color) -> String {
    #if os(macOS)
    let n = NSColor(c).usingColorSpace(.sRGB) ?? .gray
    let (r, g, b) = (n.redComponent, n.greenComponent, n.blueComponent)
    #else
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
    #endif
    return String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
}
