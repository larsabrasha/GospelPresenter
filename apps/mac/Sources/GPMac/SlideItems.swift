// What a slide shows besides a song's or Bible text, painted from the core's layout (slide_items.rs): a picture slide's
// picture and a video's still, and a slideshow's or an overlay's page, its ground, pictures, rectangles, ellipses,
// lines and texts in drawing order, as the web's CustomPageView draws them (docs/custom-slides.md).
import CoreText
import SwiftUI

extension SlideLayout {
    /// One thing on the stage. `fill`: a colour over `box`; `picture`: a picture's blobs in `box`, fitted (`contain`) or
    /// filling it (`cover`); `rect` and `ellipse`: a shape in `box` with its fill, and its border inside it; `line`: from
    /// `from` to `to`, round at the ends; `text`: a page's text, as a song's is drawn.
    struct Item: Decodable {
        let kind: String
        let box: Box?
        let color: String?
        let full: String?, thumb: String?, fit: String?
        let fill: String?, stroke: String?, strokeWidth: Double?, radius: Double?
        let from: [Double]?, to: [Double]?, width: Double?
        let text: Text?

        private enum Keys: String, CodingKey { case kind, box, color, full, thumb, fit, fill, stroke, strokeWidth, radius, from, to, width }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            kind = try c.decode(String.self, forKey: .kind)
            box = try c.decodeIfPresent(Box.self, forKey: .box)
            color = try c.decodeIfPresent(String.self, forKey: .color)
            full = try c.decodeIfPresent(String.self, forKey: .full)
            thumb = try c.decodeIfPresent(String.self, forKey: .thumb)
            fit = try c.decodeIfPresent(String.self, forKey: .fit)
            fill = try c.decodeIfPresent(String.self, forKey: .fill)
            stroke = try c.decodeIfPresent(String.self, forKey: .stroke)
            strokeWidth = try c.decodeIfPresent(Double.self, forKey: .strokeWidth)
            radius = try c.decodeIfPresent(Double.self, forKey: .radius)
            from = try c.decodeIfPresent([Double].self, forKey: .from)
            to = try c.decodeIfPresent([Double].self, forKey: .to)
            width = try c.decodeIfPresent(Double.self, forKey: .width)
            text = kind == "text" ? try Text(from: decoder) : nil
        }

        /// The colours it paints with, each of which must read.
        var colours: [String] { [color, fill, stroke].compactMap { $0 } }
    }
}

extension SlidePainter {
    /// Items in their order.
    static func paint(_ items: [SlideLayout.Item], in ctx: CGContext) {
        for item in items { paint(item, in: ctx) }
    }

    private static func paint(_ item: SlideLayout.Item, in ctx: CGContext) {
        let rect = item.box.map { CGRect(x: $0.x, y: $0.y, width: $0.w, height: $0.h) } ?? .zero
        switch item.kind {
        case "fill":
            ctx.setFillColor(item.color.flatMap(CSSColor.parse) ?? CSSColor.black)
            ctx.fill(rect)
        case "picture":
            // The full picture where this device has it, else its thumbnail; nothing while it has neither.
            guard let image = SlideFaces.picture(item.full) ?? SlideFaces.picture(item.thumb) else { return }
            draw(image, in: rect, fit: item.fit ?? "contain", in: ctx)
        case "rect", "ellipse":
            shape(item, rect, in: ctx)
        case "line":
            guard let from = item.from, let to = item.to, from.count == 2, to.count == 2, let stroke = item.stroke.flatMap(CSSColor.parse) else { return }
            ctx.saveGState()
            ctx.setStrokeColor(stroke)
            ctx.setLineWidth(item.width ?? 1)
            ctx.setLineCap(.round)
            ctx.strokeLineSegments(between: [CGPoint(x: from[0], y: from[1]), CGPoint(x: to[0], y: to[1])])
            ctx.restoreGState()
        case "text":
            if let text = item.text { paint(text, in: ctx) }
        default:
            break
        }
    }

    /// A rectangle or ellipse as CSS draws its box: the fill over the whole box, the border inside its edge
    /// (`box-sizing: border-box`), a rectangle's corners rounded at most to half its shorter side.
    private static func shape(_ item: SlideLayout.Item, _ rect: CGRect, in ctx: CGContext) {
        let path = { (r: CGRect, radius: CGFloat) -> CGPath in
            item.kind == "ellipse" ? CGPath(ellipseIn: r, transform: nil)
                : CGPath(roundedRect: r, cornerWidth: max(0, radius), cornerHeight: max(0, radius), transform: nil)
        }
        let radius = min(item.radius ?? 0, min(rect.width, rect.height) / 2)
        ctx.saveGState()
        defer { ctx.restoreGState() }
        if let fill = item.fill.flatMap(CSSColor.parse) {
            ctx.setFillColor(fill)
            ctx.addPath(path(rect, radius))
            ctx.fillPath()
        }
        if let stroke = item.stroke.flatMap(CSSColor.parse), let w = item.strokeWidth, w > 0 {
            ctx.setStrokeColor(stroke)
            ctx.setLineWidth(w)
            ctx.addPath(path(rect.insetBy(dx: w / 2, dy: w / 2), radius - w / 2))
            ctx.strokePath()
        }
    }

    /// A picture fitted to `rect` (`contain`) or filling it (`cover`, the rest clipped), centred, upright in a space whose
    /// y runs down.
    static func draw(_ image: CGImage, in rect: CGRect, fit: String, in ctx: CGContext) {
        let (iw, ih) = (CGFloat(image.width), CGFloat(image.height))
        guard iw > 0, ih > 0, rect.width > 0, rect.height > 0 else { return }
        let k = fit == "cover" ? max(rect.width / iw, rect.height / ih) : min(rect.width / iw, rect.height / ih)
        let at = CGRect(x: rect.midX - iw * k / 2, y: rect.midY - ih * k / 2, width: iw * k, height: ih * k)
        ctx.saveGState()
        ctx.clip(to: rect)
        ctx.translateBy(x: 0, y: at.maxY + at.minY)
        ctx.scaleBy(x: 1, y: -1)
        ctx.interpolationQuality = .high
        ctx.draw(image, in: at)
        ctx.restoreGState()
    }
}
