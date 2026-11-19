// GP_MAC_COMPARE=<dir> (with GP_MAC_DATA's demo): the painter's half of the picture-by-picture check against SlideView
// (apps/mac/compare.mjs, docs/native-slide-rendering.md). The demo's first 60 song slides in Classic, Ljust and three
// themes of the shipped faces that move and paint the text (a shadow, an outline, capitals), each painted at 960 × 540
// to <dir>/<theme>-<n>.png, as a tile (the part's label, no credits) and as the live picture (credits, no label, through
// LiveSlide's Canvas), and what each is to <dir>/tiles.json, for SlideView to draw the same; the painter's time to
// <dir>/timing.txt. Then the app quits. No web view here: one in the app of a locked or sleeping Mac draws nothing.
#if os(macOS)
import AppKit
import SwiftUI

@MainActor
enum Compare {
    static let pixels = CGSize(width: 960, height: 540)

    static func run(_ model: Model, out: String) {
        let dir = URL(filePath: out)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var slides: [JSONValue] = []
        var theme: JSONValue?
        for p in model.presentations {
            guard let page = model.page(p.id) else { continue }
            theme = theme ?? page.theme
            for item in page.items { for s in item.slides where s.kind == "song" && !slides.contains(s.raw) { slides.append(s.raw) } }
        }
        var tiles: [JSONValue] = []
        if let classic = theme {
            for (name, t) in themes(classic) {
                for (i, slide) in slides.prefix(60).enumerated() {
                    // Every other one as the live picture, its credits shown.
                    let label = i % 2 == 0
                    let file = "\(name)-\(i).png"
                    let tile = TileRequest(slide: slide, theme: t, overlay: nil, label: label)
                    let painted = label ? SlidePainter.image(tile, pixels: pixels) : live(tile)
                    if let painted { write(painted, dir.appending(path: file)) }
                    tiles.append(.object(["theme": .string(name), "file": .string(file), "painted": .bool(painted != nil), "label": .bool(label),
                                          "slide": slide, "themeValue": t]))
                }
            }
        }
        try? Data(JSONValue.array(tiles).text.utf8).write(to: dir.appending(path: "tiles.json"))
        if let classic = theme { time(Array(slides.prefix(60)), classic, dir) }
        NSApp.terminate(nil)
    }

    /// The painter's time a slide, after a first round (the faces read): the core's layout alone, a thumbnail and a whole
    /// stage, each the median of five rounds over the slides, to <dir>/timing.txt.
    private static func time(_ slides: [JSONValue], _ theme: JSONValue, _ dir: URL) {
        let tiles = slides.map { TileRequest(slide: $0, theme: theme, overlay: nil) }
        func ms(_ act: (TileRequest) -> Void) -> Double {
            var rounds: [Double] = []
            for _ in 0..<5 {
                let t = CFAbsoluteTimeGetCurrent()
                for tile in tiles { act(tile) }
                rounds.append((CFAbsoluteTimeGetCurrent() - t) * 1000 / Double(tiles.count))
            }
            return rounds.sorted()[2]
        }
        _ = ms { _ = SlidePainter.image($0, pixels: Thumbnails.pixels) }
        let layout = ms { _ = SlidePainter.layout($0) }
        let thumb = ms { _ = SlidePainter.image($0, pixels: Thumbnails.pixels) }
        let whole = ms { _ = SlidePainter.image($0, pixels: SlidePainter.stage) }
        let text = String(format: "a slide: layout %.2f ms, a thumbnail 480 × 270 %.2f ms, the whole stage 1920 × 1080 %.2f ms (%d slides)", layout, thumb, whole, tiles.count)
        try? text.write(to: dir.appending(path: "timing.txt"), atomically: true, encoding: .utf8)
    }

    /// The live picture as the window draws it (LiveSlide's Canvas), rendered without a screen; nil where SlideView
    /// draws it.
    private static func live(_ tile: TileRequest) -> CGImage? {
        guard SlidePainter.layout(tile) != nil else { return nil }
        let renderer = ImageRenderer(content: LiveSlide(tile: tile).frame(width: pixels.width, height: pixels.height))
        renderer.scale = 1
        return renderer.cgImage
    }

    /// Classic as the demo has it, and themes made from it that move and paint the text otherwise.
    private static func themes(_ classic: JSONValue) -> [(String, JSONValue)] {
        func with(_ main: [String: JSONValue], ground: String = "#000000", credits: [String: JSONValue] = [:]) -> JSONValue {
            var t = merge(classic, ["definition", "song", "main"], main)
            t = merge(t, ["definition", "song", "credits"], credits)
            return merge(t, ["definition", "song", "background"], ["color": .string(ground)])
        }
        let inter: JSONValue = .string("'Inter', sans-serif")
        return [
            ("classic", classic),
            ("light", with(["color": .string("#000000")], ground: "#ffffff", credits: ["color": .string("rgba(0, 0, 0, 0.4)")])),
            ("inter-shadow", with(["fontFamily": inter, "shadow": .bool(true), "color": .string("#fde68a")], ground: "#1e3a5f", credits: ["fontFamily": inter])),
            ("montserrat-outline", with(["fontFamily": .string("'Montserrat', sans-serif"), "fontWeight": .number(400), "outline": .number(3),
                                         "outlineColor": .string("#b91c1c"), "align": .string("left"), "valign": .string("top")], credits: ["fontFamily": inter])),
            ("lato-capitals", with(["fontFamily": .string("'Lato', sans-serif"), "fontWeight": .number(400), "uppercase": .bool(true),
                                    "align": .string("right"), "valign": .string("bottom"), "fontSize": .number(90)], credits: ["fontFamily": inter])),
        ]
    }

    /// `value` with `fields` set in the object at `path`.
    private static func merge(_ value: JSONValue, _ path: [String], _ fields: [String: JSONValue]) -> JSONValue {
        guard case var .object(o) = value else { return value }
        guard let key = path.first else { return .object(o.merging(fields) { $1 }) }
        o[key] = merge(o[key] ?? .object([:]), Array(path.dropFirst()), fields)
        return .object(o)
    }

    private static func write(_ image: CGImage, _ url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
    }
}
#endif
