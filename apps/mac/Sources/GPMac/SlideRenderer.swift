// Slides drawn by the web's own SlideView (Lars, 2026-11-17; docs/native-apps.md): a slide on an iPad must look as it
// does on the projector, and every output is SlideView. The renderer is apps/web's slides.html, bundled in the app and
// served from it through the `gp:` scheme, as are the pictures from the app's own storage. Many slides go into one
// page of a hidden web view, one snapshot, cut into tiles (Thumbnails.swift); the live picture is a web view of its own.
import CryptoKit
import SwiftUI
import WebKit

/// `gp://app/{path}`: the renderer's files; `gp://media/{hash}`: a picture this device keeps.
final class AppScheme: NSObject, WKURLSchemeHandler {
    let root: URL?
    let media: URL

    init(root: URL?, media: URL) { (self.root, self.media) = (root, media) }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let file: URL? = switch url.host() {
        case "app": root?.appending(path: url.path(percentEncoded: false))
        case "media": media.appending(path: url.lastPathComponent)
        default: nil
        }
        guard let file, let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!)
            task.didFinish()
            return
        }
        let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "woff2": "font/woff2", "wasm": "application/wasm", "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"]
        let type = types[file.pathExtension] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": type, "Content-Length": "\(data.count)"])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    /// The renderer's files: the app's own (`slides`), or on the Mac run from the repository GP_SLIDES.
    static var files: URL? {
        if let dir = ProcessInfo.processInfo.environment["GP_SLIDES"] { return URL(filePath: dir) }
        return Bundle.main.url(forResource: "slides", withExtension: nil)
    }

    /// Where this device keeps pictures by their hash.
    static let mediaDir: URL = URL(filePath: AppState.home).appending(path: "media")

    static func webView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppScheme(root: files, media: mediaDir), forURLScheme: "gp")
        config.suppressesIncrementalRendering = true
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 480, height: 270), configuration: config)
        #if os(iOS)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        // No room kept for the status bar or the home indicator: the page is the slides, from its corner.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isUserInteractionEnabled = false
        #else
        web.setValue(false, forKey: "drawsBackground")
        #endif
        web.load(URLRequest(url: URL(string: "gp://app/slides.html")!))
        return web
    }
}

/// What a tile draws: a slide (none for an overlay alone) in a theme, with an overlay over it.
struct TileRequest: Hashable {
    let slide: JSONValue?
    let theme: JSONValue?
    let overlay: JSONValue?
    /// The part's label on the stage, as a tile shows it.
    var label = true
    /// For a slide that draws pictures: the media files' generation (AppState.mediaGeneration), so it is drawn again
    /// when they arrive; 0 for one that draws none.
    var media = 0

    /// Whether it draws a picture of the device's: a picture, a video's still, a slideshow's page, an overlay, a
    /// theme's own picture.
    var drawsPictures: Bool {
        slide?["kind"]?.string == "media" || slide?["custom"].map { $0 != .null } == true || overlay != nil
            || ["song", "bible", "media"].contains { theme?["definition"]?[$0]?["background"]?["image"]?["kind"]?.string == "picture" || theme?["definition"]?[$0]?["image"]?["kind"]?.string == "picture" }
    }

    var json: [String: Any] {
        func any(_ v: JSONValue?) -> Any { v.flatMap { try? JSONSerialization.jsonObject(with: Data($0.text.utf8), options: .fragmentsAllowed) } ?? NSNull() }
        return ["slide": any(slide), "theme": any(theme), "overlay": any(overlay), "label": label]
    }
}

@MainActor
final class SlideRenderer {
    static let shared = SlideRenderer()
    /// The renderer bundled: its page's text, which names its scripts by their hash, so a new renderer is new keys.
    /// Read on its own, without the web view: a view's body asks for it while it draws.
    static let version: String = {
        let page = AppScheme.files.flatMap { try? Data(contentsOf: $0.appending(path: "slides.html")) } ?? Data()
        return SHA256.hash(data: page).prefix(8).map { String(format: "%02x", $0) }.joined()
    }()
    private let web: WKWebView
    private var loaded = false
    /// One sheet at a time: the web view draws one page.
    private var busy: Task<Void, Never>?

    /// The web view goes into the window only when the first sheet is drawn (`waitLoaded`), never while a view draws.
    private init() { web = AppScheme.webView() }

    /// A web view draws only in a window: this one lies outside the screen, behind everything.
    private func attach() {
        #if os(iOS)
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return }
        web.frame.origin = CGPoint(x: -10_000, y: 0)
        window.insertSubview(web, at: 0)
        #else
        let window = NSWindow(contentRect: CGRect(x: -10_000, y: 0, width: 480, height: 270), styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = web
        window.orderBack(nil)
        #endif
    }

    private func waitLoaded() async {
        if loaded { return }
        if web.superview == nil { attach() }
        for _ in 0..<200 {
            if (try? await web.evaluateJavaScript("typeof window.gpSheet === 'function'")) as? Bool == true { loaded = true; return }
            try? await Task.sleep(for: .milliseconds(25))
        }
    }

    /// The tiles drawn as one sheet, each `pixels` big in the picture, and cut out of one snapshot; nil for a tile not
    /// drawn.
    func sheet(_ tiles: [TileRequest], pixels: CGSize) async -> [CGImage?] {
        while let running = busy { await running.value }
        let task = Task { @MainActor in await self.draw(tiles, pixels: pixels) }
        busy = Task { _ = await task.value }
        defer { busy = nil }
        return await task.value
    }

    /// The density the web view draws in, which the snapshot's pixels follow: its own trait collection's on iOS (a
    /// display of another density, a window moved, the iPhone Duo's two screens), its window's on a Mac.
    private var displayScale: CGFloat {
        #if os(iOS)
        web.traitCollection.displayScale
        #else
        web.window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        #endif
    }

    private func draw(_ tiles: [TileRequest], pixels: CGSize) async -> [CGImage?] {
        var out: [CGImage?] = Array(repeating: nil, count: tiles.count)
        guard !tiles.isEmpty else { return out }
        await waitLoaded()
        // Read when it draws, in its window: a density it had before no longer holds after a move.
        let density = displayScale
        guard density > 0 else { return out }
        let size = CGSize(width: pixels.width / density, height: pixels.height / density)
        let columns = min(tiles.count, 5), rows = (tiles.count + columns - 1) / columns
        let frame = CGSize(width: size.width * CGFloat(columns), height: size.height * CGFloat(rows))
        web.frame.size = frame
        let sheet: [String: Any] = ["tiles": tiles.map(\.json), "width": size.width, "height": size.height, "columns": columns]
        guard (try? await web.callAsyncJavaScript("return await window.gpSheet(sheet)", arguments: ["sheet": sheet], contentWorld: .page)) != nil else { return out }
        let config = WKSnapshotConfiguration()
        config.rect = CGRect(origin: .zero, size: frame)
        config.afterScreenUpdates = true
        guard let picture = try? await web.takeSnapshot(configuration: config), let image = picture.cgImageOf else { return out }
        let scale = CGFloat(image.width) / frame.width
        for i in tiles.indices {
            let rect = CGRect(x: CGFloat(i % columns) * size.width * scale, y: CGFloat(i / columns) * size.height * scale,
                              width: size.width * scale, height: size.height * scale).integral
            out[i] = image.cropping(to: rect)
        }
        return out
    }
}

extension PlatformImage {
    var cgImageOf: CGImage? {
        #if os(iOS)
        cgImage
        #else
        cgImage(forProposedRect: nil, context: nil, hints: nil)
        #endif
    }
}

/// The live picture: a web view of its own drawing the slide shown, as the outputs draw it (no label, credits shown).
struct LiveWebView: View {
    let tile: TileRequest

    var body: some View { WebSlide(tile: tile).aspectRatio(16 / 9, contentMode: .fit) }
}

#if os(iOS)
private struct WebSlide: UIViewRepresentable {
    let tile: TileRequest
    func makeUIView(context: Context) -> WKWebView { AppScheme.webView() }
    func updateUIView(_ web: WKWebView, context: Context) { show(web, tile) }
}
#else
private struct WebSlide: NSViewRepresentable {
    let tile: TileRequest
    func makeNSView(context: Context) -> WKWebView { AppScheme.webView() }
    func updateNSView(_ web: WKWebView, context: Context) { show(web, tile) }
}
#endif

/// Draws `tile` in `web` once its renderer has loaded.
@MainActor
private func show(_ web: WKWebView, _ tile: TileRequest) {
    Task {
        for _ in 0..<200 {
            if (try? await web.evaluateJavaScript("typeof window.gpShow === 'function'")) as? Bool == true { break }
            try? await Task.sleep(for: .milliseconds(25))
        }
        _ = try? await web.callAsyncJavaScript("return await window.gpShow(tile)", arguments: ["tile": tile.json], contentWorld: .page)
    }
}
