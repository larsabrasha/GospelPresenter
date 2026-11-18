// `-gp.measure YES` (with `-gp.demo YES`): times the slide renderer as docs/native-apps.md reports it: one snapshot,
// a sheet of 20, and 100 slides cold (the caches emptied) and from the caches; and whether a snapshot keeps an
// overlay's clear ground. Written to the log and to Caches/measure.txt, then the app goes on.
#if os(iOS)
import Foundation
import SwiftUI

@MainActor
enum Measure {
    static func run(_ model: Model) async {
        var slides: [(Slide, JSONValue?)] = []
        for p in model.presentations {
            guard let page = model.page(p.id) else { continue }
            for item in page.items { for s in item.slides where s.kind != "media" { slides.append((s, page.theme)) } }
            if slides.count >= 100 { break }
        }
        let hundred = Array(slides.prefix(100)).map { TileRequest(slide: $0.0.raw, theme: $0.1, overlay: nil) }
        guard hundred.count >= 20 else { return }
        let size = Thumbnails.pixels
        let renderer = SlideRenderer.shared
        _ = await renderer.sheet([hundred[0]], pixels: size) // the page loaded, the fonts too
        func ms(_ act: () async -> Void) async -> Double {
            let t = Date()
            await act()
            return Date().timeIntervalSince(t) * 1000
        }
        let one = await ms { _ = await renderer.sheet([hundred[1]], pixels: size) }
        let sheet = await ms { _ = await renderer.sheet(Array(hundred[0..<20]), pixels: size) }
        Thumbnails.shared.forget()
        let cold = await ms { await withTaskGroup(of: Void.self) { g in for tile in hundred { g.addTask { _ = await Thumbnails.shared.image(tile) } } } }
        Thumbnails.shared.forgetMemory()
        let disk = await ms { await withTaskGroup(of: Void.self) { g in for tile in hundred { g.addTask { _ = await Thumbnails.shared.image(tile) } } } }
        let memory = await ms { await withTaskGroup(of: Void.self) { g in for tile in hundred { g.addTask { _ = await Thumbnails.shared.image(tile) } } } }
        // An overlay alone: its corner, outside its texts, should be clear.
        let overlay: JSONValue = .object(["version": .number(1), "elements": .array([])])
        let clear = await renderer.sheet([TileRequest(slide: nil, theme: hundred[0].theme, overlay: overlay, label: false)], pixels: size).first ?? nil
        let alpha = clear.map(cornerAlpha) ?? -1
        let report = String(format: "one snapshot %.0f ms; a sheet of 20 %.0f ms; 100 slides cold %.0f ms, from disk %.0f ms, from memory %.1f ms; an overlay's clear corner alpha %d (0 is clear)", one, sheet, cold, disk, memory, alpha)
        NSLog("GP measure: %@", report)
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "measure.txt")
        try? report.write(to: file, atomically: true, encoding: .utf8)
    }

    /// The alpha of an image's top-left pixel, 0–255.
    private static func cornerAlpha(_ image: CGImage) -> Int {
        var pixel = [UInt8](repeating: 0, count: 4)
        guard let ctx = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return -1 }
        ctx.draw(image, in: CGRect(x: 0, y: 1 - image.height, width: image.width, height: image.height))
        return Int(pixel[3])
    }
}
#endif
