// The three columns: the presentations (and the trash), a presentation's running order, and its slides.
import SwiftUI

struct PresentationsColumn: View {
    @Environment(Model.self) private var model
    @State private var editing: String?
    @State private var purging: TrashRow?

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedPresentation) {
            Section("Senast ändrade") {
                ForEach(model.presentations) { p in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name)
                            if !p.subtitle.isEmpty { Text(p.subtitle).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        Text("\(p.itemCount) inslag").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    .padding(.vertical, 3)
                    .tag(p.id)
                    .contextMenu {
                        Button("Redigera detaljer…") { editing = p.id }
                        Divider()
                        Button("Lägg i papperskorgen") {
                            model.run("trashPresentation", ["id": p.id, "at": Int(Date().timeIntervalSince1970 * 1000)])
                            if model.selectedPresentation == p.id { model.selectedPresentation = model.presentations.first?.id }
                        }
                    }
                }
            }
            if !model.trash.isEmpty {
                Section("Papperskorgen") {
                    ForEach(model.trash) { t in
                        Label(t.name, systemImage: "trash").foregroundStyle(.secondary)
                            .contextMenu {
                                Button("Återställ") { model.run("restorePresentation", ["id": t.id]) }
                                Button("Radera för gott…", role: .destructive) { purging = t }
                            }
                    }
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 260, ideal: 300)
        .toolbar {
            Button {
                let id = model.newId()
                if model.run("createPresentation", ["id": id, "name": "Ny presentation"]) == "ok" { model.selectedPresentation = id; editing = id }
            } label: { Label("Ny presentation", systemImage: "plus") }
        }
        .sheet(item: Binding(get: { editing.map { IdBox(id: $0) } }, set: { editing = $0?.id })) { box in
            DetailsSheet(presentationId: box.id)
        }
        .confirmationDialog("Radera \(purging?.name ?? "") för gott?", isPresented: Binding(get: { purging != nil }, set: { if !$0 { purging = nil } })) {
            Button("Radera för gott", role: .destructive) { if let t = purging { model.run("purgePresentation", ["id": t.id]) } }
        } message: { Text("Det går inte att ångra.") }
    }
}

struct IdBox: Identifiable { let id: String }

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

struct ItemsColumn: View {
    @Environment(Model.self) private var model
    @State private var addingSong = false
    @State private var prompt: TextPrompt?

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedItem) {
            if let note = model.current?.description, !note.isEmpty {
                Section {
                    Text(note).font(.callout).lineLimit(4).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.background, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            Section {
                ForEach(model.current?.items ?? []) { item in
                    VStack(alignment: .leading, spacing: 1) {
                        Label(item.title, systemImage: icon(item.type)).lineLimit(1)
                            .fontWeight(model.pointer?.itemId == item.id && model.presenting ? .semibold : .regular)
                        if let note = item.note { Text(note).font(.caption).foregroundStyle(.orange).lineLimit(1).padding(.leading, 26) }
                    }
                    .tag(item.id)
                    .contextMenu { ItemMenu(item: item, prompt: $prompt) }
                }
                .onMove { from, to in
                    var ids = (model.current?.items ?? []).map(\.id)
                    ids.move(fromOffsets: from, toOffset: to)
                    model.run("reorderItems", ["presentationId": model.selectedPresentation ?? "", "itemIds": ids])
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 240, ideal: 280)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                Menu {
                    Button("Sång…") { addingSong = true }
                    Button("Rubrik…") {
                        prompt = TextPrompt(title: "Ny rubrik", label: "Rubrik", text: "") { title in
                            var args: [String: Any] = ["itemId": model.newId(), "presentationId": model.selectedPresentation ?? "", "title": title]
                            if let after = model.selectedItem { args["afterItemId"] = after }
                            model.run("addHeaderToPresentation", args)
                        }
                    }
                } label: { Label("Lägg till", systemImage: "plus") }
                    .menuStyle(.borderlessButton).frame(maxWidth: .infinity)
                    .padding(.vertical, 7).background(Color.accentColor.opacity(0.12), in: Capsule())
                    .disabled(model.current == nil)
                Text(model.status).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            }
            .padding(12)
        }
        .sheet(isPresented: $addingSong) { AddSongSheet() }
        .textPrompt($prompt)
    }
}

/// An item's menu, the same in the running order and on its "···": moving it, its name, note and arrangement.
struct ItemMenu: View {
    @Environment(Model.self) private var model
    let item: ItemView
    @Binding var prompt: TextPrompt?

    var body: some View {
        if item.type == "song" && !item.arrangements.isEmpty {
            Menu("Arrangemang") {
                Toggle("Sångens standard", isOn: Binding(get: { item.arrangementId == nil }, set: { _ in
                    model.run("setItemArrangement", ["itemId": item.id, "arrangementId": NSNull()])
                }))
                ForEach(item.arrangements) { a in
                    Toggle(a.name ?? "Utan namn", isOn: Binding(get: { item.arrangementId == a.id }, set: { _ in
                        model.run("setItemArrangement", ["itemId": item.id, "arrangementId": a.id])
                    }))
                }
            }
        }
        Button("Byt namn…") {
            prompt = TextPrompt(title: "Byt namn", label: "Namn", text: item.title) { model.run("renameItem", ["itemId": item.id, "title": $0]) }
        }
        Button(item.note == nil ? "Lägg till kommentar…" : "Ändra kommentar…") {
            prompt = TextPrompt(title: "Kommentar", label: "Syns bara för den som kör", text: item.note ?? "") { model.run("setItemNote", ["itemId": item.id, "note": $0]) }
        }
        Divider()
        Button("Flytta upp") { model.run("moveItem", ["itemId": item.id, "by": -1]) }
        Button("Flytta ner") { model.run("moveItem", ["itemId": item.id, "by": 1]) }
        Divider()
        Button("Ta bort", role: .destructive) { model.run("removeItem", ["itemId": item.id]) }
            .disabled(model.presenting && model.pointer?.itemId == item.id)
    }
}

struct SlidesColumn: View {
    @Environment(Model.self) private var model
    @State private var prompt: TextPrompt?
    @FocusState private var focused: Bool
    /// The width the slides have, measured once for all of them.
    @State private var available: CGFloat = 800
    @Environment(\.displayScale) private var scale
    private static let spacing: CGFloat = 18, padding: CGFloat = 28

    /// As many tiles of at least 240 points as fit, all of one width.
    private var grid: (columns: Int, width: CGFloat) {
        let columns = max(1, Int((available + Self.spacing) / (240 + Self.spacing)))
        return (columns, ((available - Self.spacing * CGFloat(columns - 1)) / CGFloat(columns)).rounded(.down))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    ForEach(model.current?.items ?? []) { item in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 6) {
                                Text(item.title).font(.headline).foregroundStyle(.secondary)
                                Menu { ItemMenu(item: item, prompt: $prompt) } label: { Image(systemName: "ellipsis") }
                                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                                if let note = item.note { Text(note).font(.callout).foregroundStyle(.orange) }
                            }
                            if !item.slides.isEmpty {
                                LazyVGrid(columns: Array(repeating: GridItem(.fixed(grid.width), spacing: Self.spacing), count: grid.columns),
                                          alignment: .leading, spacing: Self.spacing) {
                                    ForEach(Array(item.slides.enumerated()), id: \.element.key) { n, slide in
                                        let key = model.key(item, n)
                                        SlideTile(slide: slide, number: n + 1,
                                                  mark: model.shownKey == key ? .shown : model.nextKey == key && model.presenting ? .next : nil,
                                                  picked: model.picked == SlideAt(itemId: item.id, partIndex: n), width: grid.width)
                                            .equatable()
                                            .onTapGesture {
                                                model.live(["type": "show", "itemId": item.id, "partIndex": n])
                                                model.selectedItem = item.id
                                                focused = true
                                            }
                                    }
                                }
                            }
                        }
                        .id(item.id)
                    }
                }
                .padding(Self.padding)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width - Self.padding * 2 } action: { available = $0 }
            // Every slide of the presentation drawn ahead, one at a time between other work, so a jump finds them drawn.
            .task(id: "\(model.current?.id ?? "")\u{0}\(grid.width)\u{0}\(scale)") {
                for slide in (model.current?.items ?? []).flatMap(\.slides) {
                    _ = SlideImages.shared.draw(slide, width: grid.width, scale: scale)
                    await Task.yield()
                }
            }
            .onChange(of: model.selectedItem) { _, id in
                // At once, as Keynote's and Finder's sidebars do: a slide of the view is dizzying after a while.
                if let id { proxy.scrollTo(id, anchor: .top) }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        // The keys of spec 04, as the web's useEditorKeys: → ← make a slide ready, ↵ shows it, Space steps, b Släck.
        .onKeyPress(keys: [.rightArrow, .leftArrow, .downArrow, .upArrow, .return, .space, .escape, "b", "."]) { press in
            switch press.key {
            case .rightArrow, .downArrow: model.live(["type": "pick", "delta": 1])
            case .leftArrow, .upArrow: model.live(["type": "pick", "delta": -1])
            case .return: model.live(["type": "enter"])
            case .space: model.live(["type": "step", "delta": 1])
            case .escape: model.live(["type": "escape"])
            default: model.live(["type": "black"])
            }
            return .handled
        }
        .toolbar { LiveToolbar() }
        .textPrompt($prompt)
        .alert(model.refusal ?? "", isPresented: Binding(get: { model.refusal != nil }, set: { if !$0 { model.refusal = nil } })) {}
    }
}

struct LiveToolbar: ToolbarContent {
    @Environment(Model.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some ToolbarContent {
        @Bindable var model = model
        ToolbarItemGroup {
            Picker("Roll", selection: $model.role) {
                Text("Användare").tag("user")
                Text("Admin").tag("admin")
            }
            .pickerStyle(.segmented).fixedSize().help("Rollen mutationerna körs med")
            if model.presenting {
                Button { model.live(["type": "black"]) } label: { Label("Släck", systemImage: "moon.fill").labelStyle(.titleAndIcon) }
                    .help("Släck (B)").disabled(model.pointer?.black ?? true)
                Button { model.live(["type": "stop"]); OutputPlacement.release() } label: { Label("Avsluta presentation", systemImage: "stop.fill").labelStyle(.titleAndIcon) }
                    .buttonStyle(.borderedProminent).tint(.red).keyboardShortcut(".", modifiers: .command)
            } else {
                Button {
                    model.live(["type": "start"])
                    openWindow(id: "output")
                    OutputPlacement.place()
                } label: { Label("Starta presentation", systemImage: "play.fill").labelStyle(.titleAndIcon) }
                    .buttonStyle(.borderedProminent).tint(.green)
                    .disabled(model.current?.items.allSatisfy(\.slides.isEmpty) ?? true)
            }
        }
    }
}
