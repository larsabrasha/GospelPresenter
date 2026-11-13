// A slide as the editor shows it, the output window and where it goes, and "Lägg till sång".
import AppKit
import SwiftUI

/// The theme here is the default one: white bold text on black, laid out on a 1920×1080 stage and scaled to fit, as the
/// outputs are. The text size is worked out from the lines rather than searched for (`minimumScaleFactor` lays the text
/// out again and again).
struct SlideFace: View {
    let slide: Slide
    static let stage = CGSize(width: 1920, height: 1080)

    private var fontSize: CGFloat {
        let lines = slide.text.split(separator: "\n", omittingEmptySubsequences: false)
        let longest = CGFloat(lines.map(\.count).max() ?? 1)
        // About 0.55 of the size per character in a bold system font, and 1.2 of it per line.
        return min(90, Self.stage.width * 0.84 / max(longest, 1) / 0.55, Self.stage.height * 0.8 / CGFloat(max(lines.count, 1)) / 1.2)
    }

    var body: some View {
        ZStack {
            Color.black
            if slide.kind == "media" {
                VStack(spacing: 40) {
                    Image(systemName: "photo.on.rectangle").font(.system(size: 220)).foregroundStyle(.white.opacity(0.5))
                    Text(slide.text).font(.system(size: 70)).foregroundStyle(.white.opacity(0.7)).lineLimit(2)
                }
                .padding(80)
            } else {
                Text(slide.text).font(.system(size: fontSize, weight: .bold)).foregroundStyle(.white).multilineTextAlignment(.center)
            }
        }
        .frame(width: Self.stage.width, height: Self.stage.height)
    }
}

/// A view of the stage, scaled to the width it is given.
struct Stage<Content: View>: View {
    let width: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        content.scaleEffect(width / SlideFace.stage.width, anchor: .topLeading)
            .frame(width: width, height: width * 9 / 16, alignment: .topLeading)
    }
}

enum SlideMark { case shown, next }

/// Every slide's picture at the tiles' size, drawn once: a tile then shows a bitmap, and scrolling lays out no text.
/// All tiles have one size, so one width keys the cache; a new width (the window resized) draws them anew.
@MainActor
final class SlideImages {
    static let shared = SlideImages()
    private var images: [String: NSImage] = [:]
    private var width: CGFloat = 0

    private func key(_ slide: Slide) -> String { "\(slide.kind)\u{0}\(slide.text)" }

    /// The picture if it is drawn already: what a tile's body may read (it never draws there).
    func cached(_ slide: Slide, width: CGFloat) -> NSImage? { width == self.width ? images[key(slide)] : nil }

    /// Draws the picture, outside a view update (a tile's task); none is kept if the drawing fails.
    func draw(_ slide: Slide, width: CGFloat, scale: CGFloat) -> NSImage? {
        if width != self.width { images.removeAll(); self.width = width }
        if let hit = images[key(slide)] { return hit }
        let renderer = ImageRenderer(content: Stage(width: width) { SlideFace(slide: slide) })
        renderer.scale = scale
        guard let image = renderer.nsImage else { return nil }
        images[key(slide)] = image
        return image
    }
}

struct SlideTile: View, Equatable {
    let slide: Slide
    let number: Int
    let mark: SlideMark?
    /// Made ready by the keys: ↵ shows it.
    let picked: Bool
    /// The tiles' width, the same for all of them.
    let width: CGFloat
    @Environment(\.displayScale) private var scale
    @State private var drawn: NSImage?

    static func == (a: Self, b: Self) -> Bool {
        a.slide == b.slide && a.number == b.number && a.mark == b.mark && a.picked == b.picked && a.width == b.width
    }

    var body: some View {
        ZStack {
            Color.black
            if let image = drawn ?? SlideImages.shared.cached(slide, width: width) {
                Image(nsImage: image).resizable()
            }
        }
            .frame(width: width, height: width * 9 / 16)
            .task(id: "\(slide.text)\u{0}\(width)\u{0}\(scale)") {
                drawn = SlideImages.shared.draw(slide, width: width, scale: scale)
            }
            .overlay(alignment: .topTrailing) {
                if let label = slide.label {
                    Text(label.text).font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Color(hex: label.color), in: Capsule())
                        .padding(8)
                }
            }
            .overlay(alignment: .topLeading) {
                if let mark {
                    Text(mark == .shown ? "VISAS" : "NÄSTA").font(.caption2.weight(.heavy)).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(mark == .shown ? Color.red : Color.gray, in: Capsule())
                        .padding(8)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Text("\(number)").font(.caption.bold()).foregroundStyle(.white).padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(mark == .shown ? Color.red : picked ? Color.blue : .clear, lineWidth: 4))
            .contentShape(Rectangle())
    }
}

struct OutputView: View {
    @Environment(Model.self) private var model

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black
                if let slide = model.liveSlide {
                    let w = min(geo.size.width, geo.size.height * 16 / 9)
                    Stage(width: w) { SlideFace(slide: slide) }
                }
            }
        }
        .ignoresSafeArea()
        .focusable().focusEffectDisabled()
        .onKeyPress(keys: [.rightArrow, .space, .return]) { _ in model.live(["type": "step", "delta": 1]); return .handled }
        .onKeyPress(.leftArrow) { model.live(["type": "step", "delta": -1]); return .handled }
        .onKeyPress("b") { model.live(["type": "black"]); return .handled }
    }
}

/// The output on a display of its own, filling it, when there is one besides the main one; else a window.
enum OutputPlacement {
    static func place() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            guard let window = NSApp.windows.first(where: { $0.title == "Utgång" }) else { return }
            guard let screen = NSScreen.screens.first(where: { $0 != NSScreen.main }) else { return }
            window.styleMask = [.borderless]
            window.level = .mainMenu + 1
            window.setFrame(screen.frame, display: true)
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.orderFrontRegardless()
        }
    }

    static func release() {
        NSApp.windows.first(where: { $0.title == "Utgång" && $0.styleMask.contains(.borderless) })?.close()
    }
}

struct AddSongSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [SongHit] = []
    @State private var chosen: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Lägg till sång").font(.title3.bold())
            TextField("Sök på titel, författare eller text", text: $query).textFieldStyle(.roundedBorder)
            List(hits, selection: $chosen) { hit in
                Text(hit.name).tag(hit.id)
            }
            .frame(minHeight: 280)
            HStack {
                Spacer()
                Button("Avbryt", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Lägg till") { add() }.keyboardShortcut(.defaultAction).disabled(chosen == nil)
            }
        }
        .padding(20)
        .frame(width: 440)
        .onAppear { hits = model.searchSongs("") }
        .onChange(of: query) { _, q in hits = model.searchSongs(q); chosen = hits.first?.id }
    }

    private func add() {
        guard let songId = chosen, let pid = model.selectedPresentation else { return }
        var args: [String: Any] = ["itemId": model.newId(), "presentationId": pid, "songId": songId]
        if let after = model.selectedItem { args["afterItemId"] = after }
        model.run("addSongToPresentation", args)
        dismiss()
    }
}
