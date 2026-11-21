// Imports that go through the server as well as the core, in the shell so the app and apps/mac's `parity settings`
// run the same code: a file kept in the media folder and recorded; a video read by AVFoundation and sent up in parts
// (the web's media/video.ts); a PDF drawn by PDFKit or a PowerPoint deck drawn by the desktop host as a slideshow's
// pages (the web's media/slides.ts). What each takes and makes is the core's (`videoImportView`, `imageDrawView`,
// `deckImportView`, `deckPagesView`); the words of a refusal are the app's.
import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

/// A drawn picture as JPEG at `quality`: this platform writes no WebP, as the web stores JPEG where a browser writes none.
public func jpegData(_ image: CGImage, quality: Double) -> Data? {
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? out as Data : nil
}

/// A picture fitted in `width` × `height` (never larger), drawn anew.
public func scaledImage(_ image: CGImage, width: Int, height: Int) -> CGImage? {
    guard let ctx = CGContext(data: nil, width: max(1, width), height: max(1, height), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return ctx.makeImage()
}

extension SyncClient {
    /// The bytes kept in the media folder by their SHA-256 and recorded for the sync: their hash.
    public func keepFile(_ data: Data, type: String) -> String? {
        guard let mediaDir else { return nil }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try? FileManager.default.createDirectory(at: mediaDir, withIntermediateDirectories: true)
        guard (try? data.write(to: mediaDir.appending(path: hash))) != nil else { return nil }
        recordBlob(hash, contentType: type, size: data.count)
        return hash
    }

    // MARK: video

    /// Why a video was not imported, by the web's problem names (`videos.failed…` with `codec`).
    public struct VideoRefusal: Error, Sendable { public let problem: String, codec: String? }

    private struct VideoPlan: Decodable { let refused: String?, type: String, codec: String?, entry: String, partBytes: Int, stillTime: Double }
    private struct UploadStep: Decodable { let done: Bool?, partBytes: Int?, received: Int?, error: String?, problem: String?, entry: String?, type: String? }

    /// A video imported: read, its still kept, sent up in parts, and named by `addVideo`. `progress` says how far
    /// (`reading` or `uploading`, percent).
    public func importVideo(_ url: URL, progress: @escaping (String, Int) -> Void = { _, _ in }) async -> Result<String, VideoRefusal> {
        let name = url.lastPathComponent
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .video).first else { return .failure(VideoRefusal(problem: "type", codec: nil)) }
        let formats = (try? await track.load(.formatDescriptions)) ?? []
        let fourcc = formats.first.map { CMFormatDescriptionGetMediaSubType($0) }.map { code in String(bytes: [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }, encoding: .ascii) ?? "" } ?? ""
        let duration = (try? await asset.load(.duration)).map(CMTimeGetSeconds) ?? 0
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
        guard let plan = view("videoImportView", ["name": name, "size": size, "type": type, "codec": fourcc, "duration": duration], as: VideoPlan.self) else { return .failure(VideoRefusal(problem: "other", codec: nil)) }
        if let r = plan.refused { return .failure(VideoRefusal(problem: r, codec: plan.entry)) }
        progress("reading", 0)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        guard let frame = try? await generator.image(at: CMTime(seconds: plan.stillTime, preferredTimescale: 600)).image else { return .failure(VideoRefusal(problem: "decode", codec: nil)) }
        struct Sizes: Decodable { struct S: Decodable { let width: Int, height: Int, quality: Double }; let sizes: [String: S] }
        guard let sizes = view("imageDrawView", ["width": frame.width, "height": frame.height], as: Sizes.self)?.sizes, let f = sizes["full"], let t = sizes["thumb"],
              let full = scaledImage(frame, width: f.width, height: f.height).flatMap({ jpegData($0, quality: f.quality) }),
              let thumb = scaledImage(frame, width: t.width, height: t.height).flatMap({ jpegData($0, quality: t.quality) }),
              let stillHash = keepFile(full, type: "image/jpeg"), let thumbHash = keepFile(thumb, type: "image/jpeg") else { return .failure(VideoRefusal(problem: "decode", codec: nil)) }
        guard let hash = await Server.hashed(url) else { return .failure(VideoRefusal(problem: "other", codec: nil)) }
        switch await uploadVideo(url, hash: hash, size: size, partBytes: plan.partBytes, progress: { progress("uploading", $0) }) {
        case let .failure(r): return .failure(r)
        case let .success(uploadedType):
            let contentType = uploadedType ?? plan.type
            recordBlob(hash, contentType: contentType, size: size, held: false)
            let id = UUID().uuidString.lowercased()
            if let r = mutate("addVideo", ["id": id, "fileName": name, "contentType": contentType, "codec": plan.codec ?? "h264", "hash": hash, "size": size,
                                           "duration": duration, "width": frame.width, "height": frame.height, "stillHash": stillHash, "thumbHash": thumbHash,
                                           "createdAt": Int(Date().timeIntervalSince1970 * 1000)]) {
                return .failure(VideoRefusal(problem: r.code, codec: nil))
            }
            return .success(id)
        }
    }

    /// The file in parts after what the server has (`/api/media/{hash}/upload`), then `finish`: the type the server
    /// read, or why it refused. A cut-off upload goes on from the server's last part.
    public func uploadVideo(_ url: URL, hash: String, size: Int, partBytes: Int, progress: (Int) -> Void = { _ in }) async -> Result<String?, VideoRefusal> {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return .failure(VideoRefusal(problem: "other", codec: nil)) }
        defer { try? handle.close() }
        let base = "/api/media/\(hash)/upload"
        let read = { (a: Answer) in (try? JSONDecoder().decode(UploadStep.self, from: a.body)) ?? UploadStep(done: nil, partBytes: nil, received: nil, error: nil, problem: nil, entry: nil, type: nil) }
        let refused = { (s: UploadStep, status: Int) -> VideoRefusal in
            status == 413 ? VideoRefusal(problem: "size", codec: nil) : s.error == "invalid-video" ? VideoRefusal(problem: s.problem == "codec" ? "codec" : "type", codec: s.entry) : VideoRefusal(problem: "other", codec: nil)
        }
        for _ in 0..<5 {
            guard let started = try? await server.request("POST", base, json: Core.json(["size": size]), as: session) else { continue }
            let s = read(started)
            if started.status >= 500 { continue }
            guard (200..<300).contains(started.status) else { return .failure(refused(s, started.status)) }
            if s.done != true, let part = s.partBytes, var received = s.received {
                while received < size {
                    progress(Int(Double(received) / Double(max(size, 1)) * 100))
                    try? handle.seek(toOffset: UInt64(received))
                    guard let chunk = try? handle.read(upToCount: part), let a = try? await server.put("\(base)/\(received / part + 1)", data: chunk, as: session) else { break }
                    let r = read(a)
                    if a.status == 409 || a.status == 404 || a.status >= 500 { break }
                    guard (200..<300).contains(a.status), let next = r.received else { return .failure(refused(r, a.status)) }
                    received = next
                }
                if received < size { continue }
            }
            progress(100)
            guard let finished = try? await server.request("POST", "\(base)/finish", as: session) else { continue }
            let f = read(finished)
            if finished.status == 409 || finished.status == 404 || finished.status >= 500 { continue }
            guard (200..<300).contains(finished.status) else { return .failure(refused(f, finished.status)) }
            return .success(f.type)
        }
        return .failure(VideoRefusal(problem: "other", codec: nil))
    }

    /// Where a video plays from: the server's address for it (`POST /api/media/{hash}/play`), a stream a player opens
    /// without the session's credentials; nil where the server gives none.
    /// Whether AVPlayer can stream from this host itself: not one whose self-signed certificate the person accepted
    /// (`PinnedCertificates`), which only this app's URLSession lets through; from such a host a video is fetched first.
    public var streams: Bool {
        guard server.base.scheme == "https", let host = server.base.host() else { return true }
        return PinnedCertificates.all[host] == nil
    }

    public func playURL(_ hash: String) async -> URL? {
        struct Play: Decodable { let url: String }
        guard let a = try? await server.request("POST", "/api/media/\(hash)/play", as: session), a.status == 200,
              let p = try? JSONDecoder().decode(Play.self, from: a.body) else { return nil }
        return URL(string: p.url, relativeTo: server.base)?.absoluteURL
    }

    // MARK: slideshows from a deck

    private struct DeckCheck: Decodable { let kind: String?, refused: String?, maxPages: Int }
    private struct Drawn: Decodable { struct Page: Decodable { let full: String, thumb: String }; let charts: Bool, contentType: String, pages: [Page] }

    /// A PDF or a PowerPoint deck as a slideshow's pages, as the core makes them, and whether a slide has a chart;
    /// else the web's problem name (powerpoint, oldPowerpoint, type, size, name, pages, invalid).
    public func deckPages(_ url: URL) async -> Result<(pages: Any, charts: Bool), VideoRefusal> {
        let fail = { (p: String) in Result<(pages: Any, charts: Bool), VideoRefusal>.failure(VideoRefusal(problem: p, codec: nil)) }
        guard let data = try? Data(contentsOf: url), let check = view("deckImportView", ["name": url.lastPathComponent, "size": data.count], as: DeckCheck.self) else { return fail("invalid") }
        if let r = check.refused { return fail(r) }
        var drawn: [(full: Data, thumb: Data)] = []
        var charts = false
        if check.kind == "pptx" {
            // A server without the route (the cloud) says so before the deck is sent.
            if let probe = try? await server.request("GET", "/api/slides/pptx", as: session), probe.status == 404 { return fail("powerpoint") }
            guard let answer = try? await server.put("/api/slides/pptx", data: data, as: session, method: "POST") else { return fail("invalid") }
            if answer.status == 404 { return fail("powerpoint") }
            if answer.status == 413 { return fail("size") }
            guard (200..<300).contains(answer.status), let d = try? JSONDecoder().decode(Drawn.self, from: answer.body) else { return fail(answer.error == "pages" ? "pages" : "invalid") }
            drawn = d.pages.compactMap { p in Data(base64Encoded: p.full).flatMap { f in Data(base64Encoded: p.thumb).map { (f, $0) } } }
            charts = d.charts
        } else {
            guard let doc = PDFDocument(data: data), doc.pageCount > 0 else { return fail("invalid") }
            if doc.pageCount > check.maxPages { return fail("pages") }
            for n in 0..<doc.pageCount {
                guard let page = doc.page(at: n), let full = Self.render(page) else { return fail("invalid") }
                let scale = min(1, 400 / Double(full.width), 225 / Double(full.height))
                guard let thumb = scaledImage(full, width: Int((Double(full.width) * scale).rounded()), height: Int((Double(full.height) * scale).rounded())),
                      let f = jpegData(full, quality: 0.9), let t = jpegData(thumb, quality: 0.8) else { return fail("invalid") }
                drawn.append((f, t))
            }
        }
        var kept: [[String: String]] = []
        for p in drawn {
            guard let full = keepFile(p.full, type: "image/jpeg"), let thumb = keepFile(p.thumb, type: "image/jpeg") else { return fail("invalid") }
            kept.append(["full": full, "thumb": thumb])
        }
        guard let json = (try? core.call("deckPagesView", ["pages": kept], caller: caller).get()) ?? nil,
              let pages = try? JSONSerialization.jsonObject(with: Data(json.utf8)) else { return fail("invalid") }
        return .success((pages, charts))
    }

    /// A PDF page drawn on white, fitted in 1920 × 1080 as pdf.js's viewport is scaled.
    private static func render(_ page: PDFPage) -> CGImage? {
        let box = page.bounds(for: .mediaBox)
        let scale = min(1920 / box.width, 1080 / box.height)
        let (w, h) = (min(1920, Int((box.width * scale).rounded())), min(1080, Int((box.height * scale).rounded())))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.scaleBy(x: scale, y: scale)
        ctx.translateBy(x: -box.minX, y: -box.minY)
        page.draw(with: .mediaBox, to: ctx)
        return ctx.makeImage()
    }
}
