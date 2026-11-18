// A presentation in columns, a computer or an iPad lying down (docs/layout-2-0.md, "Live, columns"; the web's
// PresentationEditor.tsx, RunningOrder.tsx, SlideList.tsx and LivePanel.tsx): the running order at the left, the
// slides of every item in the middle, and while presenting the live column at the right; each side folds away.
import SwiftUI

struct WideLayout: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    @AppStorage("gp.leftFolded") private var leftFolded = false
    @AppStorage("gp.liveFolded") private var liveFolded = false

    var body: some View {
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
        Button { withAnimation { act() } } label: { Image(systemName: symbol).frame(width: 40, height: 40) }
            .buttonStyle(.bordered).buttonBorderShape(.circle).padding(14)
            .help(t(label)).accessibilityLabel(t(label))
    }
}

/// The left column: the description, the items one row each (the shown one with a red dot and a tint), Lägg till.
private struct RunningOrderColumn: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    let fold: () -> Void

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 0) {
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
                    Menu { AddChoices(chosen: nil) } label: {
                        Label(t("live.add"), systemImage: "plus").frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.bordered).tint(.sky)
                    .listRowBackground(Color.clear)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .tint(.sky)
            HStack {
                Button(action: fold) { Image(systemName: "sidebar.left") }.buttonStyle(.borderless)
                    .help(t("presentation.hideSidebar")).accessibilityLabel(t("presentation.hideSidebar"))
                Spacer()
            }
            .padding(12)
        }
        .background(Color.sidebar)
    }
}

/// The middle: every item a section whose heading names it with its …, its slides a grid of pictures; a click shows
/// one while presenting, and before it outlines it.
private struct SlideColumn: View {
    @Environment(Model.self) private var model
    let p: PresentationView
    @FocusState private var focused: Bool
    /// The slides are 384 pt, and shrink to no less than 340 where that fits one more to a row (SlideGrid.tsx).
    @State private var available: CGFloat = 800
    private static let spacing: CGFloat = 18, padding: CGFloat = 28

    private var grid: (columns: Int, width: CGFloat) {
        let columns = max(1, Int((available + Self.spacing) / (340 + Self.spacing)))
        let width = min(384, ((available - Self.spacing * CGFloat(columns - 1)) / CGFloat(columns)).rounded(.down))
        return (columns, width)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24, pinnedViews: [.sectionHeaders]) {
                    ForEach(p.items) { item in
                        Section {
                            if let problem = item.problem { Text(t("presentation.\(problemKey(problem))")).font(.footnote).foregroundStyle(Color.quiet) }
                            LazyVGrid(columns: Array(repeating: GridItem(.fixed(grid.width), spacing: Self.spacing), count: grid.columns), alignment: .leading, spacing: Self.spacing) {
                                ForEach(Array(item.slides.enumerated()), id: \.element.key) { n, slide in
                                    tile(item, n, slide)
                                }
                            }
                        } header: {
                            HStack(spacing: 6) {
                                if model.isLive && model.live.pointer?.itemId == item.id { Circle().fill(.red).frame(width: 7, height: 7) }
                                Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.quiet)
                                Menu { ItemMenu(item: item) } label: { Image(systemName: "ellipsis") }
                                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                                    .accessibilityLabel(t("live.itemMore", ["title": item.title]))
                                if let note = item.note, !note.isEmpty { Text(note).font(.callout).foregroundStyle(.orange) }
                                Spacer()
                            }
                            .padding(.vertical, 6).background(Color.ground)
                        }
                        .id(item.id)
                    }
                }
                .padding(Self.padding)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width - Self.padding * 2 } action: { available = $0 }
            // The slides on screen are asked for first, as their tiles appear; the rest of the presentation after them.
            .task(id: p.id) {
                try? await Task.sleep(for: .milliseconds(300))
                Thumbnails.shared.prefetch(p.items.flatMap { item in item.slides.map { TileRequest(slide: $0.raw, theme: p.theme, overlay: item.overlay) } })
            }
            .onChange(of: model.selectedItem) { _, id in if let id { proxy.scrollTo(id, anchor: .top) } }
        }
        .background(Color.ground)
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        // The keys of spec 03 and 04, the web's: each key is its event, and what it does is the core's (`Model.send`,
        // `pageEventView`). ↑ ↓ step as → ←: this grid does not yet say which slide stands above another.
        .onKeyPress(phases: .down) { press in
            let command = press.modifiers.contains(.command)
            let event: [String: Any]? = switch press.key {
            case .rightArrow where command, .downArrow where command: ["type": "item", "delta": 1]
            case .leftArrow where command, .upArrow where command: ["type": "item", "delta": -1]
            case .upArrow where press.modifiers.contains(.option): ["type": "move", "delta": -1]
            case .downArrow where press.modifiers.contains(.option): ["type": "move", "delta": 1]
            case .rightArrow, .downArrow: ["type": "pick", "delta": 1]
            case .leftArrow, .upArrow: ["type": "pick", "delta": -1]
            case .pageDown: ["type": "clicker", "delta": 1]
            case .pageUp: ["type": "clicker", "delta": -1]
            case .return: ["type": "enter", "onPage": true]
            case .space: ["type": "step", "delta": 1]
            case .escape: ["type": "escape"]
            case .delete, .deleteForward: ["type": "delete"]
            case "b", "B", ".": ["type": "black"]
            case "a": ["type": "add"]
            default: press.characters.count == 1 && press.characters.first!.isWholeNumber ? ["type": "digit", "digit": Int(press.characters)!] : nil
            }
            guard let event, let answer = model.send(event) else { return .ignored }
            if let command = answer.command { model.perform(command) }
            return answer.handled ? .handled : .ignored
        }
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

/// The right column while presenting: the picture shown, Släck under it, and the slide → shows next.
private struct LiveColumn: View {
    @Environment(Model.self) private var model
    let fold: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LivePicture()
            BlackButton().frame(maxWidth: .infinity)
            if let next = nextSlide {
                Text(t("live.nextBadge")).font(.caption.weight(.semibold)).foregroundStyle(Color.quiet)
                SlideThumbnail(slide: next, theme: model.live.theme)
            }
            Spacer()
            HStack {
                Button(action: fold) { Image(systemName: "sidebar.right") }.buttonStyle(.borderless)
                    .help(t("presentation.hideLiveColumn")).accessibilityLabel(t("presentation.hideLiveColumn"))
                Spacer()
            }
        }
        .padding(16)
        .background(Color.surface)
    }

    private var nextSlide: Slide? {
        guard let key = model.live.nextKey, let page = model.live.page else { return nil }
        for item in page.items { for (n, s) in item.slides.enumerated() where slideKey(item.id, n) == key { return s } }
        return nil
    }
}
