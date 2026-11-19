// Slide thumbnails (Lars, 2026-11-17; docs/native-apps.md): painted from the core's layout (SlidePainter.swift), what
// it refuses drawn by the web's SlideView (SlideRenderer.swift), kept by
// their content, not by presentation. The key is a hash of all that changes the picture: the slide, the whole theme,
// the size and the renderer bundled, so an edited theme or a new renderer is new keys and nothing is cleared by hand.
// On disk in Caches (the system may empty it; then slides are drawn again), at most about 100 MB, the least recently
// used going first; in memory above it for what is on screen. An overlay is a layer of its own, drawn once on a clear
// ground and laid over the slide here, as the web's OverlayLayer lies over the slide. Requests that come together are
// drawn together, up to 20 a sheet, those on screen before those fetched ahead.
import CryptoKit
import SwiftUI

@MainActor
final class Thumbnails {
    static let shared = Thumbnails()
    /// A thumbnail's size in pixels: small, as the lists show them.
    static let pixels = CGSize(width: 480, height: 270)
    /// The most a sheet draws at once.
    static let perSheet = 20

    private let memory = NSCache<NSString, CGImageBox>()
    private let dir: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "slides")
    private static let diskLimit = 100 * 1024 * 1024
    private var written = 0

    private var urgent: [(TileRequest, String)] = []
    private var ahead: [(TileRequest, String)] = []
    private var waiting: [String: [CheckedContinuation<CGImage?, Never>]] = [:]
    private var pumping = false

    private init() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        memory.totalCostLimit = 64 * 1024 * 1024
    }

    /// Everything kept dropped, on disk and in memory (Measure.swift's cold run).
    func forget() {
        forgetMemory()
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    func forgetMemory() { memory.removeAllObjects() }

    /// The key of a tile: what changes its picture, hashed.
    func key(_ tile: TileRequest) -> String {
        let text = [SlideRenderer.version, SlidePainter.version, "\(Self.pixels.width)x\(Self.pixels.height)", tile.label ? "label" : "", "\(tile.media)", tile.slide?.text ?? "null", tile.theme?.text ?? "null", tile.overlay?.text ?? "null"].joined(separator: "\u{0}")
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// The picture if it is in memory: what a view may read while it draws.
    func cached(_ tile: TileRequest) -> CGImage? { memory.object(forKey: key(tile) as NSString)?.image }

    /// A slide with its overlay over it: each drawn (or found) on its own, then laid together.
    func image(_ slide: TileRequest, urgent: Bool = true) async -> CGImage? {
        let bare = TileRequest(slide: slide.slide, theme: slide.theme, overlay: nil, label: slide.label, media: slide.media)
        guard let base = await layer(bare, urgent: urgent) else { return nil }
        guard let overlay = slide.overlay else { return base }
        let key = key(slide)
        if let hit = memory.object(forKey: key as NSString)?.image { return hit }
        guard let top = await layer(TileRequest(slide: nil, theme: slide.theme, overlay: overlay, label: false, media: slide.media), urgent: urgent),
              let laid = Self.lay(top, over: base) else { return base }
        memory.setObject(CGImageBox(laid), forKey: key as NSString, cost: laid.width * laid.height * 4)
        return laid
    }

    /// Fetches ahead: the slides off screen, drawn after those on it.
    func prefetch(_ tiles: [TileRequest]) {
        for tile in tiles { Task { _ = await image(tile, urgent: false) } }
    }

    private func layer(_ tile: TileRequest, urgent isUrgent: Bool) async -> CGImage? {
        let key = key(tile)
        if let hit = memory.object(forKey: key as NSString)?.image { return hit }
        if let disk = read(key) { remember(disk, key); return disk }
        return await withCheckedContinuation { c in
            let first = waiting[key] == nil
            waiting[key, default: []].append(c)
            if first {
                if isUrgent { urgent.append((tile, key)) } else { ahead.append((tile, key)) }
            } else if isUrgent, let i = ahead.firstIndex(where: { $0.1 == key }) {
                urgent.append(ahead.remove(at: i))
            }
            pump()
        }
    }

    /// Draws what waits, a sheet at a time, those on screen first.
    private func pump() {
        guard !pumping else { return }
        pumping = true
        Task { @MainActor in
            // Requests made in the same moment (a screen of tiles appearing) go into one sheet.
            await Task.yield()
            while !urgent.isEmpty || !ahead.isEmpty {
                var batch: [(TileRequest, String)] = []
                while batch.count < Self.perSheet, !urgent.isEmpty { batch.append(urgent.removeFirst()) }
                while batch.count < Self.perSheet, !ahead.isEmpty { batch.append(ahead.removeFirst()) }
                // Painted from the core's layout; what it refuses drawn by SlideView, one sheet.
                var images = batch.map { SlidePainter.image($0.0, pixels: Self.pixels) }
                let web = images.indices.filter { images[$0] == nil }
                if AppScheme.files != nil, !web.isEmpty {
                    let drawn = await SlideRenderer.shared.sheet(web.map { batch[$0].0 }, pixels: Self.pixels)
                    for (i, image) in zip(web, drawn) { images[i] = image }
                }
                for ((_, key), image) in zip(batch, images) {
                    if let image { remember(image, key); write(image, key) }
                    for c in waiting.removeValue(forKey: key) ?? [] { c.resume(returning: image) }
                }
            }
            pumping = false
        }
    }

    private func remember(_ image: CGImage, _ key: String) {
        memory.setObject(CGImageBox(image), forKey: key as NSString, cost: image.width * image.height * 4)
    }

    // ------------------------------------------------------------ disk

    private func file(_ key: String) -> URL { dir.appending(path: "\(key).png") }

    private func read(_ key: String) -> CGImage? {
        let url = file(key)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
        // Used now: the least recently used go first when the cache is full.
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return image
    }

    private func write(_ image: CGImage, _ key: String) {
        guard let dest = CGImageDestinationCreateWithURL(file(key) as CFURL, "public.png" as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
        written += 1
        if written % 50 == 0 { trim() }
    }

    /// Keeps the folder under its limit, removing the least recently used first.
    private func trim() {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys) else { return }
        let entries = files.compactMap { url -> (URL, Date, Int)? in
            guard let v = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
            return (url, v.contentModificationDate ?? .distantPast, v.fileSize ?? 0)
        }.sorted { $0.1 < $1.1 }
        var total = entries.reduce(0) { $0 + $1.2 }
        for (url, _, size) in entries where total > Self.diskLimit {
            try? FileManager.default.removeItem(at: url)
            total -= size
        }
    }

    /// `top` laid over `base`, at `base`'s size.
    static func lay(_ top: CGImage, over base: CGImage) -> CGImage? {
        guard let ctx = CGContext(data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: base.width, height: base.height)
        ctx.draw(base, in: rect)
        ctx.draw(top, in: rect)
        return ctx.makeImage()
    }
}

final class CGImageBox {
    let image: CGImage
    init(_ image: CGImage) { self.image = image }
}

/// The colour a theme's song slides have under their text: the placeholder while a slide's picture is drawn.
func placeholder(_ theme: JSONValue?) -> Color {
    let css = theme?["definition"]?["song"]?["background"]?["color"]?.string ?? "#000000"
    return css.hasPrefix("#") && css.count == 7 ? Color(hex: css) : .black
}

/// A slide's picture as the web draws it, at a tile's size; the theme's ground until it is drawn.
struct SlideThumbnail: View {
    @Environment(Model.self) private var model
    let slide: Slide
    let theme: JSONValue?
    var overlay: JSONValue? = nil
    var label = true
    @State private var image: CGImage?

    private var request: TileRequest {
        var r = TileRequest(slide: slide.raw, theme: theme, overlay: overlay, label: label)
        if r.drawsPictures { r.media = model.app.mediaGeneration }
        return r
    }

    var body: some View {
        ZStack {
            placeholder(theme)
            if let image = image ?? Thumbnails.shared.cached(request) {
                Image(decorative: image, scale: 1).resizable().interpolation(.high)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .task(id: request) { image = await Thumbnails.shared.image(request) }
    }
}

enum SlideMark { case shown, next }

/// A slide in the middle column: its picture, VISAS or NÄSTA, its number; the one made ready outlined in blue.
struct SlideTile: View {
    let slide: Slide
    let theme: JSONValue?
    var overlay: JSONValue? = nil
    let number: Int
    let mark: SlideMark?
    let picked: Bool
    let width: CGFloat

    var body: some View {
        SlideThumbnail(slide: slide, theme: theme, overlay: overlay)
            .frame(width: width, height: width * 9 / 16)
            .overlay { AudioMark(slide: slide) }
            .overlay(alignment: .topLeading) {
                if let mark {
                    Pill(text: t(mark == .shown ? "live.shownBadge" : "live.nextBadge"), color: mark == .shown ? .red : Color.black.opacity(0.6)).padding(8)
                }
            }
            .overlay(alignment: .bottomTrailing) { Text("\(number)").font(.caption.bold()).foregroundStyle(.white).shadow(radius: 2).padding(8) }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(picked ? Color.sky : mark == .shown ? Color.red : .clear, lineWidth: 4))
            .contentShape(Rectangle())
    }
}

/// The picture shown while presenting, painted from the core's layout or drawn by the web's SlideView, as the outputs
/// draw it, a video playing in it (LivePlayer.swift); black before the first slide and after Släck. Under it the
/// controls of the video or audio file live.
struct LivePicture: View {
    @Environment(Model.self) private var model

    var body: some View {
        VStack(spacing: 8) {
            LiveSlide(tile: TileRequest(slide: model.live.slide?.raw, theme: model.live.theme, overlay: model.live.overlay, label: false, media: model.app.mediaGeneration),
                      video: model.live.slide == nil ? nil : model.app.player.video(for: model.live.state.itemId))
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.red.opacity(model.live.slide == nil ? 0 : 0.8), lineWidth: 2))
            PlayerBar()
        }
    }
}
