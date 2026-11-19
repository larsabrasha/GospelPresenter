// Slides made up for the picture-by-picture check (Compare.swift): every kind of a slideshow's page element and an
// overlay, with pictures drawn here and kept in the app's media folder by their hash, as a picture of Bilder is, so
// the app's own web view finds them as the painter does.
import CryptoKit
import SwiftUI

@MainActor
enum ComparePages {
    /// The made-up slides, each with the overlay over it (or none), and whether it shows a picture.
    static func slides() -> [(slide: JSONValue?, overlay: JSONValue?, pictures: Bool)] {
        let wide = picture(width: 1600, height: 900, hue: 0.58)
        let tall = picture(width: 600, height: 900, hue: 0.08)
        let o: (String, JSONValue) -> (String, JSONValue) = { ($0, $1) }
        func text(_ id: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ t: String, size: Double, bold: Bool = false, italic: Bool = false,
                  align: String = "left", color: String? = nil) -> JSONValue {
            .object(Dictionary(uniqueKeysWithValues: [o("id", .string(id)), o("kind", .string("text")), o("x", .number(x)), o("y", .number(y)), o("w", .number(w)),
                    o("h", .number(h)), o("text", .string(t)), o("size", .number(size)), o("bold", .bool(bold)), o("italic", .bool(italic)),
                    o("align", .string(align)), o("color", color.map(JSONValue.string) ?? .null)]))
        }
        func shape(_ id: String, _ kind: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, fill: String?, stroke: String?, width: Double, radius: Double = 0) -> JSONValue {
            .object(Dictionary(uniqueKeysWithValues: [o("id", .string(id)), o("kind", .string(kind)), o("x", .number(x)), o("y", .number(y)), o("w", .number(w)),
                    o("h", .number(h)), o("fill", fill.map(JSONValue.string) ?? .null), o("stroke", stroke.map(JSONValue.string) ?? .null),
                    o("strokeWidth", .number(width)), o("radius", .number(radius))]))
        }
        func line(_ id: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, stroke: String?, width: Double) -> JSONValue {
            .object(Dictionary(uniqueKeysWithValues: [o("id", .string(id)), o("kind", .string("line")), o("x", .number(x)), o("y", .number(y)), o("w", .number(w)),
                    o("h", .number(h)), o("stroke", stroke.map(JSONValue.string) ?? .null), o("strokeWidth", .number(width))]))
        }
        func image(_ id: String, _ pic: JSONValue, _ x: Double, _ y: Double, _ w: Double, _ h: Double, fit: String) -> JSONValue {
            .object(["id": .string(id), "kind": .string("image"), "x": .number(x), "y": .number(y), "w": .number(w), "h": .number(h), "picture": pic, "fit": .string(fit)])
        }
        func page(_ elements: [JSONValue], background: String? = nil, picture: JSONValue? = nil) -> JSONValue {
            .object(["background": background.map(JSONValue.string) ?? .null, "backgroundPicture": picture ?? .null, "backgroundPage": .null, "elements": .array(elements)])
        }
        func custom(_ p: JSONValue, key: String) -> JSONValue {
            .object(["key": .string(key), "kind": .string("song"), "text": .string(""), "verses": .null, "image": .null, "thumb": .null, "label": .null,
                     "credits": .null, "custom": p])
        }
        let shapes = page([
            text("t1", 80, 70, 900, 300, "Välkommen\ntill gudstjänsten", size: 84, bold: true),
            text("t2", 960, 120, 880, 200, "Kursiv och centrerad text som bryts på flera rader i sin ruta", size: 56, italic: true, align: "center", color: "#fde68a"),
            shape("r1", "rect", 120, 520, 520, 300, fill: "#fde68a", stroke: "#b91c1c", width: 8, radius: 36),
            shape("e1", "ellipse", 760, 500, 420, 340, fill: nil, stroke: "#ffffff", width: 6),
            shape("r2", "rect", 1300, 560, 460, 240, fill: "rgba(14, 165, 233, 0.5)", stroke: nil, width: 0),
            line("l1", 160, 960, 1600, -40, stroke: nil, width: 10),
            text("t3", 1300, 840, 500, 120, "Höger", size: 48, align: "right", color: "#ffffff"),
        ], background: "#1e3a5f")
        let pictures = page([
            image("i1", wide, 80, 80, 800, 600, fit: "contain"),
            image("i2", tall, 960, 80, 880, 600, fit: "cover"),
            text("t4", 80, 760, 1760, 200, "Bilder i rutor, anpassade och fyllande", size: 64, align: "center"),
        ])
        let ground = page([text("t5", 120, 820, 1680, 160, "Text över en bakgrundsbild", size: 72, bold: true, align: "center")], picture: tall)
        let overlay = page([shape("o1", "rect", 40, 40, 520, 110, fill: "rgba(0, 0, 0, 0.6)", stroke: nil, width: 0, radius: 20),
                            text("o2", 64, 56, 480, 80, "Kollekt: Swish 123 456", size: 40, color: "rgba(255, 255, 255, 0.9)")])
        let song: JSONValue = .object(["key": .string("s"), "kind": .string("song"), "text": .string("Härlig är jorden\nhärlig är Guds himmel"), "verses": .null, "image": .null,
                                       "thumb": .null, "label": .null, "credits": .null])
        func media(_ p: JSONValue) -> JSONValue {
            .object(["key": .string("m"), "kind": .string("media"), "text": .string(""), "verses": .null, "image": p["full"] ?? .null, "thumb": p["thumb"] ?? .null,
                     "label": .null, "credits": .null])
        }
        return [
            (custom(shapes, key: "page0"), nil, false),
            (custom(pictures, key: "page1"), nil, true),
            (custom(ground, key: "page2"), nil, true),
            (song, overlay, false),
            (nil, overlay, false),
            (media(wide), nil, true),
            (media(tall), overlay, true),
        ]
    }

    /// A picture drawn here, kept in the media folder by its hash: its `full` and `thumb` the same blob.
    private static func picture(width: Int, height: Int, hue: CGFloat) -> JSONValue {
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let colours = [CGColor(srgbRed: hue, green: 0.4, blue: 0.8, alpha: 1), CGColor(srgbRed: 1, green: 0.85, blue: hue, alpha: 1)] as CFArray
        let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colours, locations: nil)!
        ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height), options: [])
        ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        ctx.fillEllipse(in: CGRect(x: width / 4, y: height / 4, width: width / 2, height: height / 2))
        let data = NSMutableData()
        if let image = ctx.makeImage(), let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) {
            CGImageDestinationAddImage(dest, image, nil)
            CGImageDestinationFinalize(dest)
        }
        let hash = SHA256.hash(data: data as Data).map { String(format: "%02x", $0) }.joined()
        try? FileManager.default.createDirectory(at: AppScheme.mediaDir, withIntermediateDirectories: true)
        try? (data as Data).write(to: AppScheme.mediaDir.appending(path: hash))
        return .object(["full": .string(hash), "thumb": .string(hash)])
    }
}
