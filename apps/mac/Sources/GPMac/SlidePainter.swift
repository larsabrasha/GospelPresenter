// Slides painted from the core's layout (docs/native-slide-rendering.md, way 3; Lars, 2026-11-19): the core's
// slideLayoutView places every glyph on the 1920 × 1080 stage as the web's SlideView sets it, and this paints them with
// Core Text from the same faces: the theme's ground and picture, a picture slide's picture or a slideshow's page
// (SlideItems.swift), a song's or Bible text, the part's label and an overlay over all, as SlideView draws them. What
// the core refuses (a face it lacks) or this does not know how to paint (a colour it does not read) is drawn by the
// web's SlideView as before (SlideRenderer.swift). GP_PAINTER=0 draws everything with SlideView.
import CoreText
import Shell
import SwiftUI

/// slideLayoutView's answer, as far as it is painted.
struct SlideLayout: Decodable {
    struct Picture: Decodable { let kind: String, full: String?, thumb: String? }
    struct Background: Decodable { let color: String, image: Picture?, fit: String?, scrim: Double? }
    struct Paint: Decodable { let color: String, shadow: Bool?, outline: Double?, outlineColor: String? }
    struct Box: Decodable { let x, y, w, h: Double }
    /// `opacity`: a Bible slide's verse number's, 0.4; else none. `bold`: a weight the face lacks, drawn bold here.
    struct Run: Decodable { let face: String, size: Double, glyphs: [[Double]], opacity: Double?, bold: Bool? }
    /// `italic`: a page's italic text, slanted as the browser slants a face that has no italic.
    struct Text: Decodable { let role: String, face: String, weight: Double, size: Double, paint: Paint, clip: Box, runs: [Run], italic: Bool? }
    /// None: no slide, a clear ground (an overlay alone).
    let background: Background?
    /// Under the texts: a picture slide's picture, a page's ground and elements.
    let items: [Item]
    let texts: [Text]
    /// An overlay's page, over all.
    let overlay: [Item]
}

@MainActor
enum SlidePainter {
    /// Whether song slides are painted here; a new value of `version` is new thumbnail keys.
    static let enabled = ProcessInfo.processInfo.environment["GP_PAINTER"] != "0"
    static var version: String { enabled ? "painter-2" : "" }

    /// The stage every slide is drawn on (themes.ts's CANVAS).
    static let stage = CGSize(width: 1920, height: 1080)

    /// The core's layout of the tile's slide and overlay, or nil where SlideView draws it: refused by the core, or what
    /// this does not paint.
    static func layout(_ tile: TileRequest) -> SlideLayout? {
        guard enabled, let theme = tile.theme, tile.slide != nil || tile.overlay != nil else { return nil }
        SlideFaces.prepare()
        let args = #"{"slide":\#(tile.slide?.text ?? "null"),"theme":\#(theme.text),"overlay":\#(tile.overlay?.text ?? "null")}"#
        guard case let .done(json?) = start(name: "slideLayoutView", args: args, caller: nil),
              let layout = try? JSONDecoder().decode(SlideLayout.self, from: Data(json.utf8)), paintable(layout) else { return nil }
        return layout
    }

    /// Every colour read and every face had: else SlideView draws it.
    private static func paintable(_ l: SlideLayout) -> Bool {
        let items = l.items + l.overlay
        let texts = l.texts + items.compactMap(\.text)
        let colours = [l.background?.color].compactMap { $0 } + texts.flatMap { [$0.paint.color, $0.paint.outlineColor ?? "#000000"] } + items.flatMap(\.colours)
        return colours.allSatisfy { CSSColor.parse($0) != nil } && texts.allSatisfy { $0.runs.allSatisfy { SlideFaces.font($0.face) != nil } }
    }

    /// The tile at `pixels`, as a thumbnail keeps it; nil where SlideView draws it.
    static func image(_ tile: TileRequest, pixels: CGSize) -> CGImage? {
        guard let layout = layout(tile) else { return nil }
        let (w, h) = (Int(pixels.width), Int(pixels.height))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        // The stage's corner at the top, y down, as SlideView's.
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        // A tile shows the part's label and no credits, the live picture the credits and no label (slides/main.tsx).
        let shown = tile.label ? SlideLayout(background: layout.background, items: layout.items, texts: layout.texts.filter { $0.role != "credits" }, overlay: layout.overlay) : layout
        paint(shown, label: tile.label ? label(tile) : nil, in: ctx, size: pixels)
        return ctx.makeImage()
    }

    /// The part's label, as the tile's slide has it.
    private static func label(_ tile: TileRequest) -> SlideLabel? {
        guard let text = tile.slide?["label"]?["text"]?.string, let color = tile.slide?["label"]?["color"]?.string else { return nil }
        return SlideLabel(text: text, color: color)
    }

    /// The slide in a box of `size`, y down from its top: the stage scaled to fit and centred in it, as SlideView's.
    static func paint(_ l: SlideLayout, label: SlideLabel?, in ctx: CGContext, size: CGSize) {
        let scale = min(size.width / stage.width, size.height / stage.height)
        ctx.saveGState()
        defer { ctx.restoreGState() }
        ctx.translateBy(x: ((size.width - stage.width * scale) / 2).rounded(), y: ((size.height - stage.height * scale) / 2).rounded())
        ctx.scaleBy(x: scale, y: scale)
        let all = CGRect(origin: .zero, size: stage)
        ctx.clip(to: all)
        if let ground = l.background {
            ctx.setFillColor(CSSColor.parse(ground.color) ?? CSSColor.black)
            ctx.fill(all)
            picture(ground, in: ctx)
        }
        paint(l.items, in: ctx)
        for text in l.texts { paint(text, in: ctx) }
        // The label over the slide (`z-[1]`), an overlay over both (`.slide-overlay`, z-index 2).
        if let label { paint(label, in: ctx) }
        paint(l.overlay, in: ctx)
    }

    /// A theme's own picture, filling or fitted, with its scrim (SlideView's ThemePicture); nothing while this device
    /// does not have it.
    private static func picture(_ bg: SlideLayout.Background, in ctx: CGContext) {
        guard let p = bg.image, p.kind == "picture", let image = SlideFaces.picture(p.full) ?? SlideFaces.picture(p.thumb) else { return }
        draw(image, in: CGRect(origin: .zero, size: stage), fit: bg.fit ?? "cover", in: ctx)
        if let scrim = bg.scrim, scrim > 0 {
            ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: min(scrim, 100) / 100))
            ctx.fill(CGRect(origin: .zero, size: stage))
        }
    }

    /// A text's glyphs where the core put them, clipped to its box: its outline under its fill, as `paint-order: stroke
    /// fill` draws it, and one shadow under both (themes.ts's TEXT_SHADOW, `0 0.06em 0.18em rgba(0, 0, 0, 0.65)`).
    static func paint(_ t: SlideLayout.Text, in ctx: CGContext) {
        ctx.saveGState()
        defer { ctx.restoreGState() }
        ctx.clip(to: CGRect(x: t.clip.x, y: t.clip.y, width: t.clip.w, height: t.clip.h))
        // Glyphs upright in a space whose y runs down; an italic text's slanted (the positions, which the text matrix
        // turns too, set back by its slant).
        let slant: CGFloat = t.italic == true ? obliqueSlant : 0
        ctx.textMatrix = CGAffineTransform(a: 1, b: 0, c: slant, d: -1, tx: 0, ty: 0)
        if t.paint.shadow == true {
            // A shadow's offset and blur are in the device's space, not the stage's.
            let k = ctx.ctm.d
            ctx.setShadow(offset: CGSize(width: 0, height: 0.06 * t.size * k), blur: 0.18 * t.size * abs(k), color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.65))
            ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        }
        let outline = (t.paint.outline ?? 0) > 0 ? CSSColor.parse(t.paint.outlineColor ?? "#000000") : nil
        let fill = CSSColor.parse(t.paint.color) ?? CSSColor.white
        // Run by run, each at its opacity (a verse number's 40 %), its outline under its fill.
        for run in t.runs {
            guard let font = SlideFaces.ctFont(run.face, size: run.size, weight: t.weight) else { continue }
            ctx.saveGState()
            // A verse number's opacity over its outline and fill together, as CSS's opacity takes the element whole.
            if let opacity = run.opacity {
                ctx.setAlpha(opacity)
                ctx.beginTransparencyLayer(auxiliaryInfo: nil)
            }
            if let outline {
                // The glyphs' outlines stroked as paths: a context's text stroke is not drawn alike everywhere (SwiftUI's
                // Canvas strokes it wider than a bitmap's context).
                ctx.addPath(outlines(run, font, slant: slant))
                ctx.setLineWidth((t.paint.outline ?? 0) * 2)
                ctx.setStrokeColor(outline)
                ctx.strokePath()
            }
            ctx.setFillColor(fill)
            let ids = run.glyphs.map { CGGlyph($0[0]) }
            // Each baseline on a whole pixel of the stage, as WebKit sets a line before the stage is scaled; in text
            // space, which the flipped text matrix turns back: y negated.
            let at = run.glyphs.map { CGPoint(x: $0[1] + slant * $0[2].rounded(), y: -$0[2].rounded()) }
            CTFontDrawGlyphs(font, ids, at, ids.count, ctx)
            // A bold the face lacks, as WebKit draws it: the glyphs again, a 24th of the size to the right, rounded up.
            // (WebKit also widens each glyph's advance by as much, which the layout does not: such a line runs a little
            // narrower here.)
            if run.bold == true {
                let offset = (run.size / 24).rounded(.up)
                CTFontDrawGlyphs(font, ids, at.map { CGPoint(x: $0.x + offset, y: $0.y) }, ids.count, ctx)
            }
            if run.opacity != nil { ctx.endTransparencyLayer() }
            ctx.restoreGState()
        }
        if t.paint.shadow == true { ctx.endTransparencyLayer() }
    }

    /// A run's glyphs as one path on the stage, each where the run's glyphs are drawn.
    private static func outlines(_ run: SlideLayout.Run, _ font: CTFont, slant: CGFloat) -> CGPath {
        let path = CGMutablePath()
        for g in run.glyphs {
            guard let glyph = CTFontCreatePathForGlyph(font, CGGlyph(g[0]), nil) else { continue }
            path.addPath(glyph, transform: CGAffineTransform(a: 1, b: 0, c: slant, d: -1, tx: g[1], ty: g[2].rounded()))
        }
        return path
    }

    /// How far a synthetic italic leans, as WebKit's and Skia's: a quarter of the height (about 14°).
    static let obliqueSlant: CGFloat = 0.25

    /// The part's label at the stage's top right, as SlideView's: `top-6 right-10 rounded-full px-8 py-1`, the app's
    /// sans at 48 px, line height 1.5, semibold, white on the label's colour.
    private static func paint(_ label: SlideLabel, in ctx: CGContext) {
        let font = SlideFaces.systemFont(size: 48)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: label.text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
        ]))
        let width = CTLineGetTypographicBounds(line, nil, nil, nil)
        let pill = CGRect(x: stage.width - 40 - (width + 64), y: 24, width: width + 64, height: 48 * 1.5 + 8)
        ctx.saveGState()
        defer { ctx.restoreGState() }
        ctx.setFillColor(CSSColor.parse(label.color) ?? CSSColor.black)
        ctx.addPath(CGPath(roundedRect: pill, cornerWidth: pill.height / 2, cornerHeight: pill.height / 2, transform: nil))
        ctx.fillPath()
        // The baseline as CSS sets it: the line's box 72 px, the font's ascent and descent centred in it.
        let (ascent, descent) = (CTFontGetAscent(font), CTFontGetDescent(font))
        ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        ctx.setFillColor(CSSColor.white)
        ctx.textPosition = CGPoint(x: pill.minX + 32, y: pill.minY + 4 + (72 - ascent - descent) / 2 + ascent)
        CTLineDraw(line, ctx)
    }
}

/// The faces the slides are painted with: the core's own by a run's name (`slideFace`), and the system's for a family a
/// theme's stack names that the app does not ship, added to the core so it lays out with them (Classic's Tahoma, as the
/// browser on a Mac draws it).
@MainActor
enum SlideFaces {
    private static var fonts: [String: CGFont] = [:]
    private static var ctFonts: [String: CTFont] = [:]
    private static var prepared = false
    private static let pictures = NSCache<NSString, CGImageBox>()

    /// Classic's stack (themes.ts's FONT_STACKS.tahoma): the first of them this system has is added, as its browser
    /// falls back: Tahoma on a Mac, Verdana on iOS.
    private static let system = ["Tahoma", "Geneva", "Verdana"]

    static func prepare() {
        guard !prepared else { return }
        prepared = true
        for family in system {
            let wanted = CTFontDescriptorCreateWithAttributes([kCTFontFamilyNameAttribute: family] as CFDictionary)
            let found = (CTFontDescriptorCreateMatchingFontDescriptors(wanted, nil) as? [CTFontDescriptor]) ?? []
            var added = false
            for d in found {
                guard let url = CTFontDescriptorCopyAttribute(d, kCTFontURLAttribute) as? URL, url.pathExtension.lowercased() == "ttf",
                      let name = CTFontDescriptorCopyAttribute(d, kCTFontNameAttribute) as? String,
                      let data = try? Data(contentsOf: url), let font = cgFont(data) else { continue }
                addSlideFace(name: name, family: family, data: data)
                fonts[name] = font
                added = true
            }
            if added { return }
        }
    }

    private static func cgFont(_ data: Data) -> CGFont? {
        CGDataProvider(data: data as CFData).flatMap(CGFont.init)
    }

    /// A run's face: an added one, or the core's own.
    static func font(_ name: String) -> CGFont? {
        if let font = fonts[name] { return font }
        guard let data = slideFace(name: name), let font = cgFont(data) else { return nil }
        fonts[name] = font
        return font
    }

    /// The face at `size`, its weight axis at `weight` where it has one (Inter's and Montserrat's variable files).
    static func ctFont(_ name: String, size: Double, weight: Double) -> CTFont? {
        let key = "\(name) \(size) \(weight)"
        if let hit = ctFonts[key] { return hit }
        guard let cg = font(name) else { return nil }
        let wght = 0x7767_6874 // 'wght'
        let hasWeight = (cg.variationAxes as? [[String: Any]])?.contains { ($0[CGFont.variationAxisName as String] as? String) == "Weight" } ?? false
        let attributes: [CFString: Any] = hasWeight ? [kCTFontVariationAttribute: [wght: weight]] : [:]
        let font = CTFontCreateWithGraphicsFont(cg, size, nil, CTFontDescriptorCreateWithAttributes(attributes as CFDictionary))
        ctFonts[key] = font
        return font
    }

    static func systemFont(size: CGFloat) -> CTFont {
        #if os(macOS)
        NSFont.systemFont(ofSize: size, weight: .semibold)
        #else
        UIFont.systemFont(ofSize: size, weight: .semibold)
        #endif
    }

    /// A picture this device keeps, by its hash.
    static func picture(_ hash: String?) -> CGImage? {
        guard let hash else { return nil }
        if let hit = pictures.object(forKey: hash as NSString) { return hit.image }
        let url = AppScheme.mediaDir.appending(path: hash)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        pictures.setObject(CGImageBox(image), forKey: hash as NSString)
        return image
    }
}

/// The CSS colours a theme writes: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` and `rgba(…)`; nil for any other.
enum CSSColor {
    static let white = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
    static let black = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)

    static func parse(_ text: String) -> CGColor? {
        let s = text.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("#") {
            var hex = String(s.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count == 6 || hex.count == 8, let v = UInt64(hex, radix: 16) else { return nil }
            let n = hex.count == 8 ? v : v << 8 | 0xff
            return srgb([Double(n >> 24 & 0xff), Double(n >> 16 & 0xff), Double(n >> 8 & 0xff)], Double(n & 0xff) / 255)
        }
        guard s.hasPrefix("rgb"), let open = s.firstIndex(of: "("), s.hasSuffix(")") else { return nil }
        let parts = s[s.index(after: open)..<s.index(before: s.endIndex)].split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).map(String.init)
        guard parts.count == 3 || parts.count == 4 else { return nil }
        let rgb = parts.prefix(3).compactMap(Double.init)
        let alpha = parts.count == 4 ? (parts[3].hasSuffix("%") ? Double(parts[3].dropLast()).map { $0 / 100 } : Double(parts[3])) : 1
        guard rgb.count == 3, let alpha else { return nil }
        return srgb(rgb, alpha)
    }

    private static func srgb(_ rgb: [Double], _ alpha: Double) -> CGColor {
        CGColor(srgbRed: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255, alpha: alpha)
    }
}

/// The live picture and the output: painted from the core's layout where it lays the slide out, else SlideView in a
/// web view of its own.
struct LiveSlide: View {
    let tile: TileRequest

    var body: some View {
        if let layout = SlidePainter.layout(tile) {
            Canvas { gc, size in
                gc.withCGContext { ctx in MainActor.assumeIsolated { SlidePainter.paint(layout, label: nil, in: ctx, size: size) } }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
        } else {
            LiveWebView(tile: tile)
        }
    }
}
