// A presentation in one column, a phone or an iPad held upright (docs/layout-2-0.md, "Live, one column"; the web's
// pages/live/phone/PhoneLive.tsx and SlideList.tsx): while presenting the picture small at the left with Släck at its
// right; then the whole running order, each item a section whose heading sticks, every part a row with its whole
// text; a tap shows a part while presenting, and before it only outlines it; + floats at the bottom right.
import SwiftUI

struct PhoneLayout: View {
    @Environment(Model.self) private var model
    let p: PresentationView

    var body: some View {
        VStack(spacing: 0) {
            if model.isLive { LiveBlock().padding(.horizontal, 16).padding(.vertical, 10) }
            ScrollViewReader { proxy in
                List {
                    if !model.isLive, let text = p.description, !text.isEmpty {
                        Section { DescriptionCard(text: text) }
                    }
                    ForEach(p.items) { item in
                        Section {
                            if let problem = item.problem { Text(t("presentation.\(problemKey(problem))")).font(.footnote).foregroundStyle(Color.quiet) }
                            // Before presenting, an audio or video item's preview; while presenting its controls are
                            // under the live picture once it is shown.
                            if !model.isLive && (item.audio != nil || item.video != nil) { ItemPreview(item: item) }
                            ForEach(Array(item.slides.enumerated()), id: \.element.key) { n, slide in
                                PartRow(item: item, n: n, slide: slide).id(slideKey(item.id, n))
                            }
                        } header: {
                            ItemHeading(item: item)
                        }
                    }
                    // Room at the foot, so the last item's … scrolls clear of the +.
                    Color.clear.frame(height: 72).listRowBackground(Color.clear)
                }
                .page()
                #if os(iOS)
                .listSectionSpacing(.compact)
                #endif
                .onChange(of: model.live.shownKey) { _, key in
                    // The list follows the part shown only when it changed some other way than a tap in it.
                    if let key, !tapped { withAnimation { proxy.scrollTo(key, anchor: .center) } }
                    tapped = false
                }
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Menu { AddChoices(chosen: nil) } label: {
                Image(systemName: "plus").font(.title2.weight(.semibold)).frame(width: 56, height: 56)
                    .foregroundStyle(.white).floatingGlass()
            }
            .accessibilityLabel(t("live.add"))
            .padding(20)
        }
        .environment(\.phoneTapped, { tapped = true })
    }

    @State private var tapped = false
}

/// A section's heading: the item's name, a red dot while it is shown, and its … with the item's menu.
private struct ItemHeading: View {
    @Environment(Model.self) private var model
    let item: ItemView

    var body: some View {
        HStack(spacing: 6) {
            if model.isLive && model.live.pointer?.itemId == item.id { Circle().fill(.red).frame(width: 7, height: 7) }
            Text(item.title).lineLimit(1)
            if let note = item.note, !note.isEmpty { Text(note).foregroundStyle(.orange).lineLimit(1) }
            Spacer()
            Menu { ItemMenu(item: item) } label: { Image(systemName: "ellipsis").frame(width: 32, height: 28) }
                .accessibilityLabel(t("live.itemMore", ["title": item.title]))
                .removeQuestion(model, item: item)
        }
        .font(.footnote.weight(.semibold))
        .textCase(nil)
    }
}

/// A part of an item: its label, its whole text; VISAS on the one shown (its row tinted red), NÄSTA on the next, the
/// one made ready tinted blue.
private struct PartRow: View {
    @Environment(Model.self) private var model
    @Environment(\.phoneTapped) private var tapped
    let item: ItemView
    let n: Int
    let slide: Slide

    var body: some View {
        let key = slideKey(item.id, n)
        let live = model.isLive
        let shown = live && model.live.shownKey == key
        let next = live && model.live.nextKey == key
        let picked = model.pageState.picked == SlideAt(itemId: item.id, partIndex: n)
        Button {
            tapped()
            // Shown while presenting; before, made ready and its item selected, so + adds after it (the page's state).
            model.send(["type": "show", "itemId": item.id, "partIndex": n])
        } label: {
            // As the web's SlideRow: a picture, a video and a slideshow's page small, as their slide, an audio file's
            // with its speaker and its name beside; a song or a reading by its words, a part without a label by its number.
            HStack(alignment: slide.pictured ? .center : .top, spacing: 12) {
                if slide.pictured {
                    SlideThumbnail(slide: slide, theme: model.current?.theme, label: false)
                        .frame(width: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay { AudioMark(slide: slide, small: true) }
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        if let label = slide.label {
                            Pill(text: label.text, color: Color(hex: label.color))
                        } else if !slide.pictured {
                            Text("\(n + 1)").font(.footnote.weight(.semibold)).foregroundStyle(Color.quiet)
                        }
                        Spacer()
                        if shown { Pill(text: t("live.shownBadge"), color: .red) } else if next { Pill(text: t("live.nextBadge"), color: .sky.opacity(0.15), ink: .sky) }
                    }
                    .frame(minHeight: 20)
                    if !slide.pictured { Text(slide.text).font(.body).frame(maxWidth: .infinity, alignment: .leading) }
                    if let name = slide.audioName { Text(name).font(.body).lineLimit(1) }
                }
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Made ready is said as selected, and the part named by its place, for VoiceOver and the UI tests.
        .accessibilityAddTraits(picked ? .isSelected : [])
        .accessibilityIdentifier("part-\(key)")
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        // A list row is marked by its ground, as a list's selection is on iOS, not by a ring the row's edge would cut;
        // as there, a marked row has no lines to its neighbours, and a line runs to the row's right edge.
        .listRowBackground(Color.surface.overlay(shown ? Color.red.opacity(0.14) : picked ? Color.sky.opacity(0.16) : .clear))
        .listRowSeparator(shown || picked ? .hidden : .automatic)
        .alignmentGuide(.listRowSeparatorTrailing) { d in d.width + 16 }
    }
}

/// A pill: a part's label, VISAS, NÄSTA.
struct Pill: View {
    let text: String
    let color: Color
    var ink: Color = .white

    var body: some View {
        Text(text).font(.caption2.weight(.bold)).foregroundStyle(ink)
            .padding(.horizontal, 8).padding(.vertical, 2).background(color, in: Capsule())
    }
}

/// The description at the top of the running order, three lines with "mer" to unfold the rest.
struct DescriptionCard: View {
    let text: String
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(text).font(.callout).lineLimit(open ? nil : 3)
            Button(open ? t("presentation.descriptionLess") : t("presentation.descriptionMore")) { open.toggle() }
                .font(.callout).foregroundStyle(Color.sky).buttonStyle(.plain)
        }
    }
}

/// While presenting on a phone: the picture shown, small at the left, half the width; Släck at its right, and under
/// it, as the web's (LiveGlyphs.tsx), Beskrivning at the left end when there is a description and Visning at the right
/// end when there are overlays (no outputs on iOS yet), each opening its sheet.
struct LiveBlock: View {
    @Environment(Model.self) private var model
    @State private var open: Open?

    enum Open: String, Identifiable { case description, display; var id: String { rawValue } }

    var body: some View {
        let description = model.current?.description.flatMap { $0.isEmpty ? nil : $0 }
        let overlays = model.current?.overlays ?? []
        HStack(alignment: .top, spacing: 12) {
            LivePicture().frame(maxWidth: .infinity)
            VStack(spacing: 10) {
                BlackButton()
                if description != nil || !overlays.isEmpty {
                    HStack {
                        if description != nil { RoundButton(text: t("presentation.description"), symbol: "doc.text") { open = .description } }
                        Spacer()
                        if !overlays.isEmpty {
                            RoundButton(text: t("live.display"), symbol: "display", dot: model.live.state.overlayId != nil) { open = .display }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .sheet(item: $open) { which in
            switch which {
            case .description: DescriptionSheet(text: description ?? "")
            case .display: DisplaySheet(overlays: overlays)
            }
        }
    }
}

/// A round button beside Släck, named for VoiceOver; a sky dot while what it opens is on.
private struct RoundButton: View {
    let text: String
    let symbol: String
    var dot = false
    let action: () -> Void

    var body: some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 26, height: 26) }
            .buttonStyle(.bordered).buttonBorderShape(.circle).tint(Color.quiet)
            .overlay(alignment: .topTrailing) { if dot { Circle().fill(Color.sky).frame(width: 9, height: 9) } }
            .accessibilityLabel(text)
    }
}

/// Beskrivning while presenting: its whole text, and Redigera detaljer.
private struct DescriptionSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let text: String
    @State private var editing = false

    var body: some View {
        NavigationStack {
            List {
                Section { Text(text).textSelection(.enabled) }
                Section { Button(t("presentation.editDetailsMenu"), systemImage: "pencil") { editing = true } }
            }
            .closeBar(t("presentation.description"))
        }
        .presentationDetents([.medium, .large])
        .sheet(isPresented: $editing) { DetailsSheet(presentationId: model.selectedPresentation) }
    }
}

/// An overlay's switch: on while it is over what is presented.
private struct OverlayRow: View {
    @Environment(Model.self) private var model
    let id: String
    let title: String

    init?(_ overlay: JSONValue) {
        guard let id = overlay["id"]?.string else { return nil }
        (self.id, title) = (id, overlay["title"]?.string ?? "")
    }

    var body: some View {
        let on = Binding(get: { model.live.state.overlayId == id }, set: { model.showOverlay($0 ? id : nil) })
        Toggle(isOn: on) { Label(title, systemImage: "square.on.square") }
    }
}

private extension View {
    /// A sheet that only shows: its title, and the system's × to close it (on a Mac, Klar).
    func closeBar(_ title: String) -> some View { modifier(CloseBar(title: title)) }
}

private struct CloseBar: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    let title: String

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    #if os(iOS)
                    if #available(iOS 26, *) { Button(role: .close) { dismiss() } } else { Button(t("common.close")) { dismiss() } }
                    #else
                    Button(t("common.close")) { dismiss() }.keyboardShortcut(.cancelAction)
                    #endif
                }
            }
    }
}

/// Visning while presenting: a switch for each overlay, at most one on (the core's overlays' rules, `Live.set`).
private struct DisplaySheet: View {
    @Environment(Model.self) private var model
    let overlays: [JSONValue]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(overlays.compactMap(OverlayRow.init), id: \.id) { $0 }
                } header: { Text(t("overlays.title")) } footer: { Text(t("live.overlaysHint")) }
            }
            .closeBar(t("live.display"))
        }
        .presentationDetents([.medium, .large])
    }
}

/// Släck: blacks the outputs and rests while they are black; a part tapped shows one again.
struct BlackButton: View {
    @Environment(Model.self) private var model

    /// Släck as the core gives it (`pageButtonsView`'s `liveColumn`): its text, icon, role and whether it may be pressed.
    var body: some View {
        let args: [String: Any] = ["place": "liveColumn", "black": model.live.pointer?.black ?? true]
        let b = model.view("pageButtonsView", args, as: PageButtons.self)?.buttons.first { $0.id == "black" }
        // As the web's: a capsule the column's width, its symbol and word in semibold, lifted off the column (here clear
        // glass, the role `quiet`), faded while the outputs are black already.
        Button { model.send(["type": "black"]) } label: {
            HStack(spacing: 8) { Image(systemName: Look.symbol(b?.icon)); Text(t(b?.text ?? "live.clear")) }
                .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 36).contentShape(Capsule())
        }
        .buttonStyle(.plain).foregroundStyle(.primary).clearGlassCapsule()
        .disabled(!(b?.enabled ?? false)).opacity(b?.enabled ?? false ? 1 : 0.4)
        .keyboardShortcut("b", modifiers: [])
        .accessibilityIdentifier("black")
    }
}

/// The web's names for why an item has no slides (`presentation.songTrashed` and the rest).
func problemKey(_ problem: String) -> String {
    switch problem {
    case "song-trashed": "songTrashed"
    case "song-missing": "songMissing"
    case "image-missing": "imageMissing"
    case "audio-missing": "audioMissing"
    default: "empty"
    }
}

private struct PhoneTappedKey: EnvironmentKey { static let defaultValue: () -> Void = {} }
extension EnvironmentValues {
    /// A part tapped in the list: the list does not follow what it showed.
    var phoneTapped: () -> Void {
        get { self[PhoneTappedKey.self] }
        set { self[PhoneTappedKey.self] = newValue }
    }
}
