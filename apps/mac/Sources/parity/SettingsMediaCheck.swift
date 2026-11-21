// `parity settings`'s second half (SettingsCheck.swift calls it): a real video, PDF and PowerPoint deck imported by the
// shell's own import (Shell/MediaImports.swift) against the server, and Utgångar's live status while a session is
// presented and watched (Shell/LiveStatus.swift, the core's `displayStatusView`).
import AVFoundation
import CoreGraphics
import Foundation
import Shell

@MainActor
enum SettingsMediaCheck {
    static func run(alice: SyncClient, bob: SyncClient, dir: String, pptx: String?, check: (String, Bool) -> Void, wait: (Double, () -> Bool) async -> Bool) async {
        let row = { (c: SyncClient, q: String) in (try? c.core.db.query(q))?.isEmpty == false }

        // A real MP4 (H.264, two seconds), made here, imported, streamed back over plain http.
        let movie = URL(filePath: dir).appending(path: "Andakt.mp4")
        let made = await makeMovie(movie)
        check("an H.264 MP4 made for the check", made)
        switch await alice.importVideo(movie) {
        case let .failure(r): check("the video imported (\(r.problem) \(r.codec ?? ""))", false)
        case let .success(id):
            check("the video imported, its still kept, sent in parts", true)
            check("pushed with its still uploaded", await wait(10) { alice.pendingCount == 0 && !alice.busy && alice.rejected.isEmpty })
            check("the other device has the video", await wait(5) { row(bob, "SELECT 1 FROM videos WHERE id = '\(id)'") })
            let hash = (try? alice.core.db.query("SELECT hash, still_hash FROM videos WHERE id = '\(id)'"))?.first
            if case let .text(h)? = hash?.first, let url = await bob.playURL(h) {
                let asset = AVURLAsset(url: url)
                let duration = (try? await asset.load(.duration)).map(CMTimeGetSeconds) ?? 0
                let tracks = (try? await asset.loadTracks(withMediaType: .video)) ?? []
                check("the other device plays it from the server's play address (\(String(format: "%.1f", duration)) s)", duration > 1.5 && !tracks.isEmpty)
            } else { check("the server gives a play address", false) }
            if case let .text(still)? = hash?.last {
                check("the still reaches the other device", await bob.media(still, to: URL(filePath: dir).appending(path: "still")))
            }
        }

        // A PDF of two pages, drawn here by PDFKit, as a new slideshow and then as new pages for it.
        let pdf = URL(filePath: dir).appending(path: "Predikan.pdf")
        makePDF(pdf, pages: 2)
        switch await alice.deckPages(pdf) {
        case let .failure(r): check("a PDF as pages (\(r.problem))", false)
        case let .success((pages, _)):
            check("a PDF as two pages, each the picture of its page", (pages as? [[String: Any]])?.count == 2 && (pages as? [[String: Any]])?.allSatisfy { ($0["backgroundPage"] as? [String: Any])?["full"] is String } == true)
            check("the slideshow made", alice.mutate("createCustomSlide", ["id": "D1", "name": "Predikan.pdf", "pages": pages, "at": 2000]) == nil)
        }
        if let pptx {
            switch await alice.deckPages(URL(filePath: pptx)) {
            case let .failure(r): check("the PowerPoint deck drawn by the host (\(r.problem))", false)
            case let .success((pages, charts)):
                let n = (pages as? [Any])?.count ?? 0
                check("the PowerPoint deck drawn by the host: \(n) pages, charts \(charts)", n == 5 && charts)
                check("Ersätt med ny fil: the slideshow's pages replaced by the deck's", alice.mutate("updateCustomSlide", ["id": "D1", "pages": pages, "at": 3000]) == nil)
            }
        } else {
            check("the PowerPoint deck (no gp-pptx program built)", false)
        }
        check("pushed with every page uploaded", await wait(15) { alice.pendingCount == 0 && !alice.busy && alice.rejected.isEmpty })
        let pagesOnBob = { () -> Int in
            guard case let .text(t)? = (try? bob.core.db.query("SELECT pages FROM custom_slides WHERE id = 'D1'"))?.first?.first,
                  let p = try? JSONSerialization.jsonObject(with: Data(t.utf8)) as? [Any] else { return 0 }
            return p.count
        }
        check("the other device has the slideshow with the deck's pages", await wait(5) { pagesOnBob() == 5 })

        // Lagring: a presentation kept offline there, with the bytes of the deck's pictures its folder holds.
        _ = bob.mutate("createPresentation", ["id": "K1", "name": "Söndag"])
        _ = bob.mutate("addCustomSlideToPresentation", ["itemId": "K1i", "presentationId": "K1", "slideId": "D1"])
        _ = try? bob.core.db.query("INSERT OR REPLACE INTO pinned_presentations (id, pinned_at) VALUES ('K1', 1)", [])
        let pictures = ((try? bob.core.db.query("SELECT j.value FROM custom_slides, json_tree(custom_slides.pages) j WHERE custom_slides.id = 'D1' AND j.key IN ('full', 'thumb')")) ?? [])
            .compactMap { row -> String? in if case let .text(h)? = row.first { h } else { nil } }
        struct Report: Decodable { struct Offline: Decodable { let presentationId: String, bytes: Int }; let offline: [Offline] }
        let held = Set(pictures).map { ["hash": $0, "size": 1000, "at": 0] as [String: Any] }
        let report = bob.view("mediaStorageView", ["presenting": NSNull(), "persistent": true, "keepComing": false, "today": "2026-11-21", "days": 7, "held": held], as: Report.self)
        check("Lagring: the presentation kept offline takes its \(held.count) pictures' bytes (\(report?.offline.map { "\($0.presentationId) \($0.bytes)" } ?? []))",
              !held.isEmpty && report?.offline.first { $0.presentationId == "K1" }?.bytes == held.count * 1000)

        // Utgångar's live status: a screen and a public output, a session presenting to the public one, one watching it.
        _ = alice.mutate("createDisplay", ["id": "S1", "name": "Projektorn", "code": "abcdefg", "kind": "screen"])
        _ = alice.mutate("createDisplay", ["id": "P1", "name": "Följ med", "code": "hjkmnpq", "kind": "public"])
        check("the outputs pushed", await wait(10) { alice.pendingCount == 0 && !alice.busy })
        guard let server = try? Server(bob.session.server) else { return }
        let owner = server.socket("/api/live/socket", clientId: "owner", as: bob.session)
        owner.resume()
        let own: [String: Any] = ["type": "own", "state": ["sessionId": "L1", "presentationId": "pres", "presentationName": "Gudstjänst", "deviceName": "iPad",
                                                           "remote": false, "pointer": ["itemId": NSNull(), "partIndex": 0, "black": false, "overlayId": NSNull(), "rev": 1], "outputs": ["P1"]]]
        try? await owner.send(.string(Core.json(own)))
        let base = bob.session.server
        // Each stream on a session of its own, so closing it closes its connection, as a page closed does.
        let (watchSession, screenSession) = (URLSession(configuration: .ephemeral), URLSession(configuration: .ephemeral))
        let watcher = Task { _ = try? await watchSession.bytes(from: URL(string: "\(base)/api/watch/hjkmnpq/stream?v=0123456789abcdef")!).0.lines.reduce(0) { n, _ in n + 1 } }
        let screen = Task { _ = try? await screenSession.bytes(from: URL(string: "\(base)/api/display/abcdefg/stream?v=fedcba9876543210")!).0.lines.reduce(0) { n, _ in n + 1 } }
        let live = LiveStatus()
        live.start(alice.session)
        struct Status: Decodable { let status: String?, n: Int?, sending: String?, live: Bool }
        var status: [String: Status] = [:]
        let seen = await wait(10) {
            let args: [String: Any] = ["displays": [["id": "S1", "kind": "screen"], ["id": "P1", "kind": "public"]], "sessions": live.sessions, "online": live.online, "connected": live.connected]
            status = alice.view("displayStatusView", args, as: [String: Status].self) ?? [:]
            return status["S1"]?.status == "screens.online" && status["P1"]?.n == 1 && status["P1"]?.sending == "Gudstjänst"
        }
        check("Utgångar: the screen online, the public output sent to by Gudstjänst with 1 watching (\(status.mapValues { "\($0.status ?? "-") \($0.n ?? 0)" }))", seen)
        watcher.cancel()
        screen.cancel()
        watchSession.invalidateAndCancel()
        screenSession.invalidateAndCancel()
        // A closed stream is noticed by the server at its next ping to it (STREAM_PING_MS, 15 s): wait past that.
        let gone = await wait(25) {
            let args: [String: Any] = ["displays": [["id": "S1", "kind": "screen"], ["id": "P1", "kind": "public"]], "sessions": live.sessions, "online": live.online, "connected": live.connected]
            status = alice.view("displayStatusView", args, as: [String: Status].self) ?? [:]
            return status["S1"]?.status == "screens.offline" && status["P1"]?.n == 0
        }
        check("and offline and none watching once they close (\(status.mapValues { "\($0.status ?? "-") \($0.n ?? 0)" }), connected \(live.connected))", gone)
        live.stop()
        owner.cancel(with: .goingAway, reason: nil)
    }

    /// Two seconds of H.264 at 320 × 240, frames of changing colour, written by AVAssetWriter.
    static func makeMovie(_ url: URL) async -> Bool {
        try? FileManager.default.removeItem(at: url)
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return false }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 320, AVVideoHeightKey: 240])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 240])
        writer.add(input)
        guard writer.startWriting() else { return false }
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<50 {
            while !input.isReadyForMoreMediaData { try? await Task.sleep(for: .milliseconds(5)) }
            var buffer: CVPixelBuffer?
            guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let b = buffer else { return false }
            CVPixelBufferLockBaseAddress(b, [])
            memset(CVPixelBufferGetBaseAddress(b), Int32(frame * 5 % 255), CVPixelBufferGetDataSize(b))
            CVPixelBufferUnlockBaseAddress(b, [])
            adaptor.append(b, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 25))
        }
        input.markAsFinished()
        await writer.finishWriting()
        return writer.status == .completed
    }

    /// A PDF of `pages` landscape pages, each with its number written large.
    private static func makePDF(_ url: URL, pages: Int) {
        var box = CGRect(x: 0, y: 0, width: 842, height: 595)
        guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
        for n in 1...pages {
            ctx.beginPDFPage(nil)
            ctx.setFillColor(CGColor(red: 0.1, green: 0.3, blue: 0.6, alpha: 1))
            ctx.fill(CGRect(x: 100, y: 100, width: 200 * CGFloat(n), height: 200))
            ctx.endPDFPage()
        }
        ctx.closePDF()
    }
}
