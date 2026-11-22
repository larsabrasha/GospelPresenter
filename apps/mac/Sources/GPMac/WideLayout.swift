// A presentation in columns, a computer or an iPad lying down (docs/layout-2-0.md, "Live, columns"; the web's
// PresentationEditor.tsx, RunningOrder.tsx, SlideList.tsx and LivePanel.tsx): the running order at the left, the
// slides of every item in the middle, and while presenting the live column at the right; each side folds away.
import SwiftUI

struct WideLayout: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    @AppStorage("gp.leftFolded") private var leftFolded = false
    @AppStorage("gp.liveFolded") private var liveFolded = false
    #if os(macOS)
    @State private var sidebar: NavigationSplitViewVisibility = .all
    @State private var liveOut = true
    #endif

    var body: some View {
        #if os(macOS)
        // A Mac's own: the running order a sidebar of glass the whole window's height, and while presenting the live
        // column an inspector at the right (Lars, 2026-11-21, as System Settings). Both fold alike, by a button at
        // their foot, and come back by one floating at the slides' foot on their side, as the core lays them out
        // (`presentationColumnsView`) and the web has them; not by the toolbar's own sidebar button.
        // The columns' state in @State, set within an animation, so the split view and the inspector slide; kept for
        // the next window in @AppStorage (whose own changes the split view does not animate).
        // Each column dragged wider or narrower within the core's bounds, but never folded by that: the system's own
        // folding as an edge is dragged past its least width is ignored (`foldsByDrag`; beside the slides' scrollbar it
        // folded them by mistake, Lars, 2026-11-21); only the buttons fold them.
        let order = Columns.width(model, "runningOrder", presenting: model.isLive, fallback: .init(ideal: 300, min: 240, max: 420))
        let live = Columns.width(model, "live", presenting: true, fallback: .init(ideal: 340, min: 300, max: 480))
        NavigationSplitView(columnVisibility: Binding(get: { sidebar }, set: { _ in })) {
            RunningOrderColumn(p: p, fold: { withAnimation { sidebar = .detailOnly } })
                .navigationSplitViewColumnWidth(min: order.min, ideal: order.ideal, max: order.max)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            // A view of its own, reading whether the presentation is live itself: inline, the split view did not run
            // this column again when presenting started after the window appeared, so neither the live column nor its
            // button came (Lars, 2026-11-21).
            WideDetail(p: p, liveWidth: live.ideal, sidebar: $sidebar, liveOut: $liveOut)
        }
        .onAppear { sidebar = leftFolded ? .detailOnly : .all; liveOut = !liveFolded }
        .onChange(of: sidebar) { _, now in leftFolded = now == .detailOnly }
        .onChange(of: liveOut) { _, now in liveFolded = !now }
        .onChange(of: model.isLive) { _, now in if now && columnOutOnStart("live") { withAnimation { liveOut = true } } }
        .removeQuestion(model)
        #else
        columns
        #endif
    }

    /// An iPad's: the columns side by side, each side folded by its own button.
    private var columns: some View {
        HStack(spacing: 0) {
            if !leftFolded {
                RunningOrderColumn(p: p, fold: { withAnimation { leftFolded = true } })
                    .frame(width: 300).transition(.move(edge: .leading))
                Divider()
            }
            SlideColumn(p: p)
                .overlay(alignment: .bottomLeading) { if leftFolded { unfold("sidebar.left", "presentation.showSidebar") { leftFolded = false } } }
                .overlay(alignment: .bottomTrailing) { if model.isLive && liveFolded { unfold("sidebar.right", "presentation.showLiveColumn") { liveFolded = false } } }
            if model.isLive && !liveFolded {
                Divider()
                LiveColumn(fold: { withAnimation { liveFolded = true } }).frame(width: 340).transition(.move(edge: .trailing))
            }
        }
        .onChange(of: model.isLive) { _, now in if now { liveFolded = false } }
        .removeQuestion(model)
    }

    private func unfold(_ symbol: String, _ label: String, _ act: @escaping () -> Void) -> some View {
        unfoldButton(symbol, label, act)
    }

    /// Whether a column comes out again at each start (`presentationColumnsView`).
    private func columnOutOnStart(_ id: String) -> Bool {
        model.view("presentationColumnsView", ["presenting": true], as: Columns.self)?.columns.first { $0.id == id }?.outOnStart ?? true
    }
}

/// A folded column's way back: its round button at the slides' foot on its side, clear of the slides' scrollbar, which
/// runs down the trailing edge to the foot (14 pt from the edge it stood over the scrollbar's foot, Lars, 2026-11-21).
private func unfoldButton(_ symbol: String, _ label: String, _ act: @escaping () -> Void) -> some View {
    FoldButton(symbol: symbol, label: label) { withAnimation { act() } }.padding(14).padding(.trailing, symbol == "sidebar.right" ? 16 : 0)
}

#if os(macOS)
/// A Mac's middle and right: the slides, and while presenting the live column beside them, a column of its own there
/// only while it is out (as the system's inspector, folded, its edge stayed at the window's and dragged out over the
/// slides' scrollbar, Lars, 2026-11-21). The slides stay the same view, keeping their place, as it comes and goes; it
/// keeps the core's ideal width, not dragged.
private struct WideDetail: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    let liveWidth: CGFloat
    @Binding var sidebar: NavigationSplitViewVisibility
    @Binding var liveOut: Bool

    var body: some View {
        let live = model.isLive
        HStack(spacing: 0) {
            SlideColumn(p: p)
                .overlay(alignment: .bottomLeading) { if sidebar == .detailOnly { unfoldButton("sidebar.left", "presentation.showSidebar") { sidebar = .all } } }
                .overlay(alignment: .bottomTrailing) { if live && !liveOut { unfoldButton("sidebar.right", "presentation.showLiveColumn") { liveOut = true } } }
            // Its width, not its presence, comes and goes: removed at once, the slides and their scrollbar jumped to the
            // window's edge while it was still sliding out over them (Lars, 2026-11-21); narrowed, they follow its edge as
            // it goes. At no width it is a view of our own with nothing to drag out.
            if live {
                let out = liveOut
                HStack(spacing: 0) {
                    Divider()
                    LiveColumn(fold: { withAnimation { liveOut = false } }).frame(width: liveWidth)
                }
                .frame(width: out ? liveWidth + 1 : 0, alignment: .leading)
                .clipped()
                .allowsHitTesting(out)
                .accessibilityHidden(!out)
            }
        }
    }
}
#endif

/// The side columns as the core lays them out (`presentationColumnsView`): what each holds, in order, and its foot.
struct Columns: Decodable {
    struct Width: Decodable { let ideal: CGFloat, min: CGFloat, max: CGFloat }
    struct Column: Decodable { let id: String, shown: Bool, parts: [String], foot: [String], outOnStart: Bool, width: Width, foldsByDrag: Bool }
    let columns: [Column]

    /// A column's widths (`presentationColumnsView`'s `width`), or `fallback` where the core gave none.
    @MainActor static func width(_ model: Model, _ id: String, presenting: Bool, fallback: Width) -> Width {
        model.view("presentationColumnsView", ["presenting": presenting], as: Columns.self)?.columns.first { $0.id == id }?.width ?? fallback
    }
}

/// A column's fold, at its foot, and a folded one's way back: the same round button of clear glass on both sides.
struct FoldButton: View {
    let symbol: String, label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) { Image(systemName: symbol).font(.body).frame(width: 36, height: 36).contentShape(Circle()) }
            .buttonStyle(.plain).foregroundStyle(.primary).clearGlassCircle()
            .help(t(label)).accessibilityLabel(t(label))
    }
}

/// The left column: the description, the items one row each (the shown one with a red dot and a tint), Lägg till.
/// Lägg till, the web's filled sky button, a menu of its choices: a menu takes no filled button style, so the capsule is
/// drawn here, of filled glass in the role's colour (the core's `add`); the icon and the words side by side, not a
/// Label, which a menu's button draws as its title alone.
private struct AddMenu: View {
    var body: some View {
        Menu { AddChoices(chosen: nil) } label: {
            HStack(spacing: 6) { Image(systemName: Look.symbol("add")); Text(t("live.add")) }
                .font(.body.weight(.medium))
                .padding(.horizontal, 16).padding(.vertical, 8).filledCapsule(Color.sky)
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
    }
}

private struct RunningOrderColumn: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    /// Folds the column; none where the system's sidebar has its own button (a Mac).
    let fold: (() -> Void)?
    /// Whether Lägg till under the last item is in view; while it is not, it floats at the column's foot.
    @State private var addInView = true
    /// How far Lägg till under the last item stands from the column's leading edge.
    @State private var addX: CGFloat = 20

    var body: some View {
        VStack(spacing: 0) {
            if model.ticking != nil { TickList(p: p) } else { order }
            if let fold {
                ColumnFoot(foot: ["fold"], symbol: "sidebar.left", label: "presentation.hideSidebar", fold: fold).padding(12)
            }
        }
        // A Mac's sidebar is the system's glass; an iPad's column its own grey.
        #if os(macOS)
        .background(Color.clear)
        #else
        .background(Color.sidebar)
        #endif
    }

    /// The items, each its row, and Lägg till.
    private var order: some View {
        @Bindable var model = model
        return Group {
            List(selection: $model.selectedItem) {
                if let text = p.description, !text.isEmpty {
                    Section { DescriptionCard(text: text) }
                }
                Section {
                    ForEach(p.items) { item in
                        let shown = model.isLive && model.live.pointer?.itemId == item.id
                        HStack(spacing: 8) {
                            Label(item.title, systemImage: icon(item.type)).lineLimit(1)
                            Spacer(minLength: 0)
                            if let note = item.note, !note.isEmpty { Image(systemName: "text.bubble").foregroundStyle(.orange) }
                        }
                        .frame(minHeight: 36)
                        .overlay(alignment: .leading) { if shown { Circle().fill(.red).frame(width: 7, height: 7).offset(x: -14) } }
                        .tag(item.id)
                        .listRowBackground(shown ? Color.red.opacity(0.08) : Color.clear)
                        .contextMenu { ItemMenu(item: item) }
                    }
                    .onMove { from, to in
                        var ids = p.items.map(\.id)
                        ids.move(fromOffsets: from, toOffset: to)
                        model.run("reorderItems", ["presentationId": p.id, "itemIds": ids])
                    }
                }
                Section {
                    // Under the last item while it is in view; scrolled out of it, the same floats at the foot (the
                    // core's `sticky`, presentationColumnsView).
                    AddMenu().listRowBackground(Color.clear)
                        .onAppear { addInView = true }
                        .onDisappear { addInView = false }
                        // Where it stands from the column's edge, so the floating one stands there too.
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("order")).minX } action: { addX = $0 }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .hardTopEdge()
            .tint(.sky)
            .overlay(alignment: .bottomLeading) { if !addInView { AddMenu().padding(.leading, addX).padding(.bottom, 12).transition(.opacity) } }
            .animation(.easeOut(duration: 0.15), value: addInView)
            .coordinateSpace(.named("order"))
        }
    }
}

/// The middle: every item a section whose heading names it with its …, its slides a grid of pictures; a click shows
/// one while presenting, and before it outlines it.
private struct SlideColumn: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    @FocusState private var focused: Bool
    /// The slides are 384 pt, and shrink to no less than 340 where that fits one more to a row (the core's
    /// `slideGridView`).
    @State private var available: CGFloat = 800
    /// The width the number of slides to a row was last worked out for: it follows `available` once that has stood
    /// still a moment, so while a side column slides in or out the slides only scale, and the rows are laid out again
    /// once, at its end, as Photos and Finder do (Lars, 2026-11-21: they were laid out again at every step).
    @State private var settled: CGFloat = 800
    @State private var settling: Task<Void, Never>?
    /// Each item's heading's height, measured: with it every slide's place is known exactly (SlideGridLayout).
    @State private var headings: [String: CGFloat] = [:]
    /// The place at the top of the view, held while the width changes (`keepsPlace`), else followed as it scrolls.
    @State private var anchor: SlideGridLayout.Anchor?
    @State private var holding = false
    private static let spacing = SlideGridLayout.spacing, padding = SlideGridLayout.padding

    private struct Grid: Decodable { let columns: Int, tileWidth: CGFloat }

    /// The rows' count for the settled width, the tiles' width for the width now (the core's `slideGridView`).
    private var grid: (columns: Int, width: CGFloat) {
        let columns = model.view("slideGridView", ["width": settled, "spacing": Self.spacing], as: Grid.self)?.columns ?? 1
        let now = model.view("slideGridView", ["width": available, "spacing": Self.spacing, "columns": columns], as: Grid.self)
        return (columns, now?.tileWidth ?? 340)
    }

    private var layout: SlideGridLayout {
        SlideGridLayout(counts: p.items.map(\.slides.count), headings: p.items.map { headings[$0.id] ?? 40 }, columns: grid.columns, tileWidth: grid.width)
    }

    /// The width now; the rows' count follows it a moment later, once it stands still. The place at the top is held
    /// meanwhile, and let go a moment after.
    private func resized(_ width: CGFloat) {
        holding = true
        available = width
        settling?.cancel()
        settling = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250)) // past a column's fold, so its slide is done first
            if Task.isCancelled { return }
            settled = width
            try? await Task.sleep(for: .milliseconds(150)) // the rows laid out again, and the place given back
            if !Task.isCancelled { holding = false }
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // The headings scroll with their slides: pinned, they stood under the toolbar's glass with the slides
                // cut behind them (Lars, 2026-11-21).
                // Not lazy: every slide's place is known exactly (SlideGridLayout), so the one at the top, and how far
                // into it, is held while the width changes; a lazy stack only guesses what it has not placed (WWDC26
                // 321; Lars, 2026-11-21: the slides jumped as a column folded). A service is some hundred slides.
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(p.items) { item in
                        heading(item).id(item.id)
                            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { headings[item.id] = $0 }
                        rows(item).padding(.bottom, Self.spacing)
                    }
                }
                .padding(Self.padding)
            }
            .modifier(KeepsPlace(layout: layout, anchor: $anchor, holding: holding))
            .onGeometryChange(for: CGFloat.self) { $0.size.width - Self.padding * 2 } action: { width in
                if settled == 800 && available == 800 { (available, settled) = (width, width) } else { resized(width) }
            }
            // The slides on screen are asked for first, as their tiles appear; the rest of the presentation after them.
            .task(id: p.id) {
                try? await Task.sleep(for: .milliseconds(300))
                Thumbnails.shared.prefetch(p.items.flatMap { item in item.slides.map { TileRequest(slide: $0.raw, theme: p.theme, overlay: item.overlay) } })
            }
            .onChange(of: model.selectedItem) { _, id in if let id { proxy.scrollTo(id, anchor: .top) } }
            .hardTopEdge()
        }
        .background(Color.ground)
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        // The keys of spec 03 and 04, the web's: each key is its event, and what it does is the core's (`Model.send`,
        // `pageEventView`). ↑ ↓ go to the slide above or below as the tiles stand (`across`).
        .onKeyPress(phases: .down) { press in key(press.key, press.modifiers, press.characters) ? .handled : .ignored }
        // `-gp.keys down,up,…`: those keys pressed once the grid stands, through the same way as a keyboard's, for
        // the UI tests, whose typeKey reaches only the on-screen keyboard on iOS (ios/UITests/GridKeysTests.swift).
        .task(id: p.id) {
            guard let keys = UserDefaults.standard.string(forKey: "gp.keys") else { return }
            let named: [String: KeyEquivalent] = ["down": .downArrow, "up": .upArrow, "right": .rightArrow, "left": .leftArrow]
            try? await Task.sleep(for: .seconds(1)) // the headings measured, so the tiles stand where they are drawn
            for name in keys.split(separator: ",") { if let k = named[String(name)] { _ = key(k, [], "") } }
        }
    }

    /// A key on the grid: its event, and the core's answer done (`Model.send`, `pageEventView`); whether it was the
    /// page's.
    private func key(_ key: KeyEquivalent, _ modifiers: EventModifiers, _ characters: String) -> Bool {
        let command = modifiers.contains(.command)
        let option = modifiers.contains(.option)
        let event: [String: Any]? = switch key {
        case .rightArrow where command, .downArrow where command: ["type": "item", "delta": 1]
        case .leftArrow where command, .upArrow where command: ["type": "item", "delta": -1]
        case .upArrow where option: ["type": "move", "delta": -1]
        case .downArrow where option: ["type": "move", "delta": 1]
        case .downArrow where !modifiers.contains(.shift): across(1)
        case .upArrow where !modifiers.contains(.shift): across(-1)
        case .rightArrow: ["type": "pick", "delta": 1]
        case .leftArrow: ["type": "pick", "delta": -1]
        case .pageDown: ["type": "clicker", "delta": 1]
        case .pageUp: ["type": "clicker", "delta": -1]
        case .return: ["type": "enter", "onPage": true]
        case .space: ["type": "step", "delta": 1]
        case .escape: ["type": "escape"]
        case .delete, .deleteForward: ["type": "delete"]
        case "b", "B", ".": ["type": "black"]
        case "a": ["type": "add"]
        default: characters.count == 1 && characters.first!.isWholeNumber ? ["type": "digit", "digit": Int(characters)!] : nil
        }
        // Past the first or last row, the key is still the page's; with Shift it is not (the web's useEditorKeys).
        if key == .downArrow || key == .upArrow, event == nil { return !modifiers.contains(.shift) }
        guard let event, let answer = model.send(event) else { return false }
        if let command = answer.command { model.perform(command) }
        return answer.handled
    }

    /// ↑ ↓: the slide above (-1) or below (1) the one made ready, else the one shown, as the tiles stand (the core's
    /// `slideAcrossView`, the web's slideGridNav.ts); none past the first or last row.
    private func across(_ dir: Int) -> [String: Any]? {
        let from = model.pageState.picked ?? (model.isLive ? model.live.state.itemId.map { SlideAt(itemId: $0, partIndex: model.live.state.partIndex) } : nil)
        let args: [String: Any] = ["tiles": layout.tiles(p.items.map(\.id)), "from": from.map { "\($0.itemId)/\($0.partIndex)" } ?? NSNull(), "dir": dir]
        guard let key = model.view("slideAcrossView", args, as: SlideKey.self)?.key, let cut = key.lastIndex(of: "/"),
              let part = Int(key[key.index(after: cut)...]) else { return nil }
        return ["type": "pickAt", "itemId": String(key[..<cut]), "partIndex": part]
    }

    /// An item's slides in rows of the grid's number, each slide its width (SlideGridLayout's heights).
    private func rows(_ item: ItemView) -> some View {
        let (columns, width) = grid
        let slides = Array(item.slides.enumerated())
        let count = (slides.count + columns - 1) / columns
        return VStack(alignment: .leading, spacing: Self.spacing) {
            ForEach(0..<count, id: \.self) { row in
                HStack(spacing: Self.spacing) {
                    ForEach(slides[(row * columns)..<min(slides.count, (row + 1) * columns)], id: \.element.key) { n, slide in
                        tile(item, n, slide).frame(width: width, height: width * 9 / 16)
                    }
                }
            }
        }
    }

    /// An item's heading the grid's width: the red dot while it is shown, its title, its …, its comment; under it why it
    /// has no slides, and before presenting an audio or video item's preview (the web's ItemMedia).
    private func heading(_ item: ItemView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if model.isLive && model.live.pointer?.itemId == item.id { Circle().fill(.red).frame(width: 7, height: 7) }
                Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.quiet)
                Menu { ItemMenu(item: item) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .accessibilityLabel(t("live.itemMore", ["title": item.title]))
                if let note = item.note, !note.isEmpty { Text(note).font(.callout).foregroundStyle(.orange) }
                Spacer()
            }
            if let problem = item.problem { Text(t("presentation.\(problemKey(problem))")).font(.footnote).foregroundStyle(Color.quiet) }
            if !model.isLive && (item.audio != nil || item.video != nil) { ItemPreview(item: item).frame(maxWidth: 512, alignment: .leading) }
        }
        .padding(.top, 18).padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tile(_ item: ItemView, _ n: Int, _ slide: Slide) -> some View {
        let key = slideKey(item.id, n)
        let live = model.isLive
        let mark: SlideMark? = live && model.live.shownKey == key ? .shown : live && model.live.nextKey == key ? .next : nil
        let picked = model.pageState.picked == SlideAt(itemId: item.id, partIndex: n)
        return SlideTile(slide: slide, theme: p.theme, overlay: item.overlay, number: n + 1, mark: mark, picked: picked, width: grid.width)
            .onTapGesture {
                model.send(["type": "show", "itemId": item.id, "partIndex": n])
                focused = true
            }
            // A tile is a button to VoiceOver and the UI tests, made ready said as selected, named by its place.
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
            .accessibilityIdentifier("part-\(key)")
    }
}

/// The right column while presenting, what the core lays in it (`presentationColumnsView`'s `live`): the picture shown
/// with Släck, never the next slide; Utgångar and Tillåt fjärrstyrning (Outputs.swift). Not here yet, so left out:
/// Överlägg.
private struct LiveColumn: View {
    @Environment(Model.self) private var model
    let fold: () -> Void

    var body: some View {
        let column = model.view("presentationColumnsView", ["presenting": true], as: Columns.self)?.columns.first { $0.id == "live" }
        VStack(alignment: .leading, spacing: 16) {
            ForEach(column?.parts ?? ["picture"], id: \.self) { part in
                if part == "picture" {
                    LivePicture()
                    BlackButton().frame(maxWidth: .infinity)
                }
                if part == "outputs" { OutputsGroup() }
            }
            Spacer()
            ColumnFoot(foot: column?.foot ?? ["fold"], symbol: "sidebar.right", label: "presentation.hideLiveColumn", side: .trailing, fold: fold)
        }
        .padding(16)
        .background(Color.surface)
        .pairingSheet(model)
    }
}

/// A column's foot as the core lays it (`presentationColumnsView`'s `foot`): its fold at its edge.
private struct ColumnFoot: View {
    let foot: [String]
    let symbol: String, label: String
    /// The column's side of the window; its fold stands at its inner edge, beside the slides (`presentationColumnsView`'s
    /// `foldEdge`), the outer left to the sync line or Fjärrstyrning, which this app does not draw there yet.
    var side: HorizontalEdge = .leading
    let fold: () -> Void

    var body: some View {
        HStack {
            if side == .leading { Spacer() }
            if foot.contains("fold") { FoldButton(symbol: symbol, label: label, action: fold) }
            if side == .trailing { Spacer() }
        }
    }
}
