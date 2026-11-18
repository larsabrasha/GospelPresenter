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
                            ForEach(Array(item.slides.enumerated()), id: \.element.key) { n, slide in
                                PartRow(item: item, n: n, slide: slide).id(slideKey(item.id, n))
                                    .listRowBackground(Color.surface)
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
            Menu { AddChoices(after: model.addAfter) } label: {
                Image(systemName: "plus").font(.title2.weight(.semibold)).frame(width: 56, height: 56)
                    .foregroundStyle(.white).background(Color.sky, in: Circle()).shadow(radius: 4, y: 2)
            }
            .accessibilityLabel(t("live.add"))
            .padding(20)
        }
        .removeQuestion(model)
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
        }
        .font(.footnote.weight(.semibold))
        .textCase(nil)
    }
}

/// A part of an item: its label, its whole text; VISAS on the one shown (a red ring), NÄSTA on the next, the one made
/// ready outlined in blue.
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
        let picked = model.live.picked == SlideAt(itemId: item.id, partIndex: n)
        Button {
            tapped()
            model.live.press(model, ["type": "show", "itemId": item.id, "partIndex": n])
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    if let label = slide.label { Pill(text: label.text, color: Color(hex: label.color)) }
                    Spacer()
                    if shown { Pill(text: t("live.shownBadge"), color: .red) } else if next { Pill(text: t("live.nextBadge"), color: .sky.opacity(0.15), ink: .sky) }
                }
                if slide.kind == "media" {
                    SlideThumbnail(slide: slide, theme: model.current?.theme).frame(maxWidth: 220)
                } else {
                    Text(slide.text).font(.body).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 12).strokeBorder(shown ? Color.red : picked ? Color.sky : .clear, lineWidth: 2.5).padding(-6)
        }
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

/// While presenting on a phone: the picture shown, small at the left, half the width; Släck at its right.
struct LiveBlock: View {
    @Environment(Model.self) private var model

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            LivePicture().frame(maxWidth: .infinity)
            BlackButton().frame(maxWidth: .infinity)
        }
    }
}

/// Släck: blacks the outputs and rests while they are black; a part tapped shows one again.
struct BlackButton: View {
    @Environment(Model.self) private var model

    var body: some View {
        Button { model.live.press(model, ["type": "black"]) } label: {
            Label(t("live.clear"), systemImage: "display").frame(maxWidth: .infinity).padding(.vertical, 8)
        }
        .buttonStyle(.bordered).buttonBorderShape(.capsule)
        .disabled(model.live.pointer?.black ?? true)
        .keyboardShortcut("b", modifiers: [])
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
