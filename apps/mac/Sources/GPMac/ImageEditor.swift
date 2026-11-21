// A library picture edited (the web's image-editor/ImageEditor.tsx and CropFrame.tsx, MEDIA-R19), as Photos edits one:
// each step the core's (`imageEditView`: turn left, mirror, straighten, a crop format, a corner or the crop dragged,
// reset), the picture drawn as the core says (`imageDrawView`'s steps) whole under its crop frame, and Klar drawing it
// cut at the stored sizes (`editImage`), or putting the original back when nothing is left of the edit (`revertImage`).
import SwiftUI

private struct EditState: Decodable {
    struct Size: Decodable { let width: Double, height: Double }
    struct Format: Decodable, Hashable { let id: String, text: String?, name: String? }
    let edit: JSONValue, frame: Size, edited: Size, none: Bool, formats: [Format]
}

private struct DrawPlan: Decodable {
    struct Step: Decodable { let op: String, x: Double?, y: Double?, radians: Double? }
    struct Rect: Decodable { let x, y, width, height: Double }
    struct Size: Decodable { let width: Double, height: Double, quality: Double }
    let steps: [Step], rect: Rect, sizes: [String: Size]
}

struct ImageEditorSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let image: MediaFile
    @State private var original: CGImage?
    @State private var state: EditState?
    @State private var format = "free"
    @State private var comparing = false
    @State private var saving = false
    @State private var message: String?

    private var size: (Double, Double) {
        if let w = image.originalWidth, let h = image.originalHeight { return (w, h) }
        return (image.width ?? 1, image.height ?? 1)
    }

    var body: some View {
        VStack(spacing: 16) {
            if let original, let state {
                stage(original, state)
                tools(state)
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .padding()
        .background(Color.black)
        .foregroundStyle(.white)
        .sheetBar(t("imageEditor.title", ["name": image.fileName]), confirm: t("library.done"), disabled: saving) { Task { await save() }; return false }
        .sheetSize(640, 560)
        .task { await load() }
        .refusal($message)
    }

    private func load() async {
        guard let url = await MediaFiles.file(image.originalFullHash ?? image.fullHash ?? "", store: model.store),
              let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return message = t("images.fetching") }
        original = CGImageSourceCreateImageAtIndex(src, 0, nil)
        var args: [String: Any] = ["width": size.0, "height": size.1]
        if let e = image.edit.flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) { args["edit"] = e }
        state = model.view("imageEditView", args, as: EditState.self)
    }

    private func step(_ op: String, _ more: [String: Any] = [:]) {
        guard let state else { return }
        let args: [String: Any] = ["width": size.0, "height": size.1, "edit": state.edit.any, "op": op, "format": format].merging(more) { _, b in b }
        if let next = model.view("imageEditView", args, as: EditState.self) { self.state = next }
    }

    // MARK: the stage

    private func stage(_ original: CGImage, _ state: EditState) -> some View {
        GeometryReader { geo in
            let shown = comparing ? (size.0, size.1) : (state.frame.width, state.frame.height)
            let fit = min((geo.size.width - 32) / shown.0, (geo.size.height - 32) / shown.1)
            let drawn = CGSize(width: max(1, (shown.0 * fit).rounded(.down)), height: max(1, (shown.1 * fit).rounded(.down)))
            let edit: Any = comparing ? NSNull() : state.edit.any
            let plan = model.view("imageDrawView", ["width": size.0, "height": size.1, "edit": edit, "outWidth": drawn.width, "outHeight": drawn.height, "whole": true], as: DrawPlan.self)
            ZStack {
                Canvas { gc, _ in
                    guard let plan else { return }
                    var g = gc
                    apply(plan, to: &g)
                    g.draw(Image(decorative: original, scale: 1), in: CGRect(x: plan.rect.x, y: plan.rect.y, width: plan.rect.width, height: plan.rect.height))
                }
                .frame(width: drawn.width, height: drawn.height)
                if !comparing { cropFrame(state, drawn) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func apply(_ plan: DrawPlan, to g: inout GraphicsContext) {
        for s in plan.steps {
            switch s.op {
            case "scale": g.scaleBy(x: s.x ?? 1, y: s.y ?? 1)
            case "translate": g.translateBy(x: s.x ?? 0, y: s.y ?? 0)
            case "rotate": g.rotate(by: .radians(s.radians ?? 0))
            default: break
            }
        }
    }

    /// The crop over the whole picture: dimmed outside, a corner dragged sizes it, a drag inside moves it.
    private func cropFrame(_ state: EditState, _ drawn: CGSize) -> some View {
        let c = state.edit["crop"]
        let v = { (k: String) -> Double in if case let .number(n)? = c?[k] { n } else { 0 } }
        let rect = CGRect(x: v("x") * drawn.width, y: v("y") * drawn.height, width: v("w") * drawn.width, height: v("h") * drawn.height)
        return ZStack(alignment: .topLeading) {
            Path { p in p.addRect(CGRect(origin: .zero, size: drawn)); p.addRect(rect) }.fill(Color.black.opacity(0.5), style: FillStyle(eoFill: true))
            Rectangle().stroke(Color.white, lineWidth: 2).frame(width: rect.width, height: rect.height).offset(x: rect.minX, y: rect.minY)
                .contentShape(Rectangle())
                .gesture(DragGesture().onEnded { g in step("move", ["dx": g.translation.width / drawn.width, "dy": g.translation.height / drawn.height]) })
            ForEach(["nw", "ne", "sw", "se"], id: \.self) { corner in
                let x = corner.hasSuffix("w") ? rect.minX : rect.maxX, y = corner.hasPrefix("n") ? rect.minY : rect.maxY
                Circle().fill(Color.white).frame(width: 18, height: 18).offset(x: x - 9, y: y - 9)
                    .gesture(DragGesture().onEnded { g in step("corner", ["corner": corner, "dx": g.translation.width / drawn.width, "dy": g.translation.height / drawn.height]) })
            }
        }
        .frame(width: drawn.width, height: drawn.height, alignment: .topLeading)
    }

    // MARK: the tools

    private func tools(_ state: EditState) -> some View {
        VStack(spacing: 12) {
            let degrees: Double = { if case let .number(n)? = state.edit["straighten"] { n } else { 0 } }()
            HStack {
                Image(systemName: "level")
                Slider(value: Binding(get: { degrees }, set: { step("straighten", ["degrees": ($0 * 10).rounded() / 10]) }), in: -45...45)
                Text(String(format: "%.1f°", degrees)).monospacedDigit().frame(width: 52)
            }
            Picker(t("imageEditor.format"), selection: Binding(get: { format }, set: { format = $0; step("format") })) {
                ForEach(state.formats, id: \.self) { f in Text(f.text.map { t($0) } ?? f.name ?? "").tag(f.id) }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 16) {
                Button(t("imageEditor.rotate"), systemImage: "rotate.left") { step("turnLeft") }
                Button(t("imageEditor.flip"), systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right") { step("mirror") }
                Button(t("imageEditor.reset")) { step("reset"); format = "free" }.disabled(state.none)
                Spacer()
                Text(t(comparing ? "imageEditor.original" : "imageEditor.compare"))
                    .padding(.horizontal, 12).padding(.vertical, 6).background(.white.opacity(0.15), in: Capsule())
                    .onLongPressGesture(minimumDuration: 0, pressing: { comparing = $0 }, perform: {})
                    .accessibilityHint(t("imageEditor.holdForOriginal"))
            }
            .buttonStyle(.borderless)
            // As Photos' tools: icons, their names for VoiceOver and as help.
            .labelStyle(.iconOnly)
            .font(.title3)
        }
    }

    // MARK: Klar

    /// The edited picture drawn at the stored sizes and saved; nothing left of the edit puts the original back.
    private func save() async {
        guard let original, let state, !saving else { return }
        saving = true
        defer { saving = false }
        if state.none {
            if image.originalFullHash != nil, let e = change(model, "revertImage", ["id": image.id]) { return message = e }
            return dismiss()
        }
        let sizes = model.view("imageDrawView", ["width": size.0, "height": size.1, "edit": state.edit.any], as: DrawPlan.self)?.sizes ?? [:]
        guard let full = sizes["full"], let thumb = sizes["thumb"],
              let fullData = render(original, state.edit, full), let thumbData = render(original, state.edit, thumb),
              let fullHash = keepFile(fullData, type: "image/jpeg", model: model), let thumbHash = keepFile(thumbData, type: "image/jpeg", model: model)
        else { return message = t("common.saveFailed") }
        if let e = change(model, "editImage", ["id": image.id, "fullHash": fullHash, "thumbHash": thumbHash, "width": Int(full.width), "height": Int(full.height), "edit": state.edit.any]) {
            return message = e
        }
        dismiss()
    }

    /// The original drawn with the edit, cut, on white (JPEG has no transparency), at `out`.
    private func render(_ original: CGImage, _ edit: JSONValue, _ out: DrawPlan.Size) -> Data? {
        guard let plan = model.view("imageDrawView", ["width": size.0, "height": size.1, "edit": edit.any, "outWidth": out.width, "outHeight": out.height], as: DrawPlan.self),
              let ctx = CGContext(data: nil, width: Int(out.width), height: Int(out.height), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: out.width, height: out.height))
        // y down, as the web's canvas the steps are for.
        ctx.translateBy(x: 0, y: out.height)
        ctx.scaleBy(x: 1, y: -1)
        ctx.interpolationQuality = .high
        for s in plan.steps {
            switch s.op {
            case "scale": ctx.scaleBy(x: s.x ?? 1, y: s.y ?? 1)
            case "translate": ctx.translateBy(x: s.x ?? 0, y: s.y ?? 0)
            case "rotate": ctx.rotate(by: s.radians ?? 0)
            default: break
            }
        }
        // The picture upright in the y-down space: drawn flipped back within its own rectangle.
        let r = plan.rect
        ctx.translateBy(x: r.x, y: r.y + r.height)
        ctx.scaleBy(x: 1, y: -1)
        ctx.draw(original, in: CGRect(x: 0, y: 0, width: r.width, height: r.height))
        guard let image = ctx.makeImage() else { return nil }
        return PictureFiles.encode(image, quality: out.quality)
    }
}
