// A picture chosen for a theme's background or a slideshow's page (the web's custom-slides/ImagePicker.tsx): one of
// the library's pictures, or a file of this device fitted and encoded as the core says (`mediaImportView`) and kept
// without joining the library, as the web's keepPicture. Either is recorded in `media_blobs` so the change naming it
// passes (`requireBlobs`), and goes up before it is pushed.
import ImageIO
import Shell
import SwiftUI
import UniformTypeIdentifiers

/// A picture as a theme or a page names it.
struct ChosenPicture: Hashable { let full: String, thumb: String, width: Int, height: Int }

enum PictureFiles {
    private struct Plan: Decodable {
        struct Size: Decodable { let width: Int, height: Int, quality: Double }
        let refused: String?, full: Size?, thumb: Size?
    }

    /// A picture file fitted, encoded and kept: its two hashes and its size; nil when the core refuses it.
    @MainActor static func keep(_ url: URL, model: Model) -> ChosenPicture? {
        guard let data = try? Data(contentsOf: url), let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return nil }
        var (w, h) = ((props[kCGImagePropertyPixelWidth] as? Int) ?? 0, (props[kCGImagePropertyPixelHeight] as? Int) ?? 0)
        // Upright, as a camera's orientation says (the web's `decodeUpright`).
        if let o = props[kCGImagePropertyOrientation] as? Int, o >= 5 { swap(&w, &h) }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
        guard let plan = model.view("mediaImportView", ["kind": "image", "name": url.lastPathComponent, "size": data.count, "type": type, "width": w, "height": h], as: Plan.self),
              plan.refused == nil, let full = plan.full, let thumb = plan.thumb,
              // JPEG: this platform writes no WebP, as the web stores JPEG where a browser writes none.
              let fullBytes = jpeg(source, plan: full), let thumbBytes = jpeg(source, plan: thumb),
              let fullHash = keepFile(fullBytes, type: "image/jpeg", model: model), let thumbHash = keepFile(thumbBytes, type: "image/jpeg", model: model) else { return nil }
        return ChosenPicture(full: fullHash, thumb: thumbHash, width: full.width, height: full.height)
    }

    /// The picture drawn upright at the plan's size, as JPEG at its quality.
    private static func jpeg(_ source: CGImageSource, plan: Plan.Size) -> Data? {
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                        kCGImageSourceThumbnailMaxPixelSize: max(plan.width, plan.height)]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return encode(image, quality: plan.quality)
    }

    /// A drawn picture as JPEG (the shell's `jpegData`).
    static func encode(_ image: CGImage, quality: Double) -> Data? { jpegData(image, quality: quality) }

    /// A library picture's files here and recorded, fetched first when this device lacks them: whether they are.
    @MainActor static func ready(_ hashes: [String], model: Model) async -> Bool {
        for hash in hashes {
            guard let url = await MediaFiles.file(hash, store: model.store), let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return false }
            model.app.recordBlob(hash, contentType: "image/jpeg", size: size)
        }
        return true
    }
}

/// The library's pictures as a grid, and Välj fil… for one of this device's.
struct PicturePickerSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let chosen: (ChosenPicture) -> Void
    @State private var importing = false
    @State private var message: String?

    var body: some View {
        let images = model.view("imagesView", as: [MediaFile].self) ?? []
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                ForEach(images) { f in
                    Button {
                        Task {
                            guard let full = f.fullHash, let thumb = f.thumbHash, await PictureFiles.ready([full, thumb], model: model) else { return message = t("images.fetching") }
                            chosen(ChosenPicture(full: full, thumb: thumb, width: Int(f.width ?? 0), height: Int(f.height ?? 0)))
                            dismiss()
                        }
                    } label: {
                        Group {
                            if let h = f.thumbHash, let image = platformImage(AppScheme.mediaDir.appending(path: h)) { image.resizable().scaledToFill() }
                            else { Color.raised.overlay(Image(systemName: "photo").foregroundStyle(.secondary)) }
                        }
                        .frame(height: 80).clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain).accessibilityLabel(f.fileName)
                }
            }
            .padding()
        }
        .toolbar { ToolbarItem(placement: .primaryAction) { Button(t("images.emptyImport"), systemImage: "plus") { importing = true } } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP, .gif]) { result in
            guard case let .success(url) = result else { return }
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            guard let picture = PictureFiles.keep(url, model: model) else { return message = t("images.failed", ["n": 1]) }
            chosen(picture)
            dismiss()
        }
        .sheetBar(t("slideEditor.backgroundImage"), confirm: t("common.close")) { true }
        .refusal($message)
        .sheetSize(520, 420)
    }
}
