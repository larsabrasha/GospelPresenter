// `parity settings-tls <sessions.json> <dir> <fingerprint>`: Videor's preview from a host on https with a self-signed
// certificate the person accepted (GP_TLS=self-signed, docs/lan-https-and-addresses.md). AVPlayer cannot stream from
// it itself, as only this app's URLSession lets that certificate through; so the preview fetches the file first
// (`SyncClient.streams` false) and plays it from the media folder, which this checks against a real server.
import AVFoundation
import Foundation
import Shell

@MainActor
enum SettingsTlsCheck {
    static func run(_ sessionsFile: String, _ dir: String, _ fingerprint: String) async -> Int32 {
        guard let data = FileManager.default.contents(atPath: sessionsFile),
              let sessions = try? JSONDecoder().decode([String: Session].self, from: data),
              let a = sessions["alice"], let b = sessions["bob"], let host = URL(string: a.server)?.host() else {
            print("FAIL: no sessions in \(sessionsFile)")
            return 1
        }
        var failures: Int32 = 0
        func check(_ what: String, _ ok: Bool) {
            print("\(ok ? "ok" : "FAIL"): \(what)")
            if !ok { failures += 1 }
        }
        func wait(_ seconds: Double, _ done: () -> Bool) async -> Bool {
            let start = Date()
            while Date().timeIntervalSince(start) < seconds {
                if done() { return true }
                try? await Task.sleep(for: .milliseconds(20))
            }
            return false
        }
        // The certificate accepted, as the connect page's "Lita på" keeps it; taken away again at the end.
        PinnedCertificates.all[host] = fingerprint
        defer { PinnedCertificates.all[host] = nil }
        do {
            let media = URL(filePath: dir).appending(path: "media")
            try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
            let alice = try SyncClient(path: "\(dir)/alice.sqlite", session: a)
            alice.mediaDir = media
            let bob = try SyncClient(path: "\(dir)/bob.sqlite", session: b)
            alice.start()
            bob.start()
            check("https: both connect through the accepted certificate", await wait(5) { alice.connected && bob.connected && !alice.busy && !bob.busy })

            let movie = URL(filePath: dir).appending(path: "Andakt.mp4")
            check("https: an H.264 MP4 made for the check", await SettingsMediaCheck.makeMovie(movie))
            guard case let .success(id) = await alice.importVideo(movie) else { check("https: the video imported", false); return 1 }
            check("https: the video imported and pushed", await wait(10) { alice.pendingCount == 0 && !alice.busy && alice.rejected.isEmpty })
            check("https: the other device has the video", await wait(5) { (try? bob.core.db.query("SELECT 1 FROM videos WHERE id = '\(id)'"))?.isEmpty == false })
            guard case let .text(hash)? = (try? alice.core.db.query("SELECT hash FROM videos WHERE id = '\(id)'"))?.first?.first else { return 1 }

            // What was the gap: AVPlayer streaming from the play address refuses the certificate.
            if let url = await bob.playURL(hash) {
                let streamed = (try? await AVURLAsset(url: url).load(.duration)).map(CMTimeGetSeconds) ?? 0
                check("https: AVPlayer itself cannot stream from it (\(String(format: "%.1f", streamed)) s), so the preview does not stream", streamed == 0 && !bob.streams)
            } else { check("https: the server gives a play address", false) }

            // The preview's way: the file fetched through the accepted certificate, checked by its hash, played here.
            let file = URL(filePath: dir).appending(path: hash)
            check("https: the other device fetches the video", await bob.media(hash, to: file))
            let asset = AVURLAsset(url: file, options: [AVURLAssetOverrideMIMETypeKey: "video/mp4"])
            let duration = (try? await asset.load(.duration)).map(CMTimeGetSeconds) ?? 0
            let tracks = (try? await asset.loadTracks(withMediaType: .video)) ?? []
            check("https: and plays it from its folder (\(String(format: "%.1f", duration)) s)", duration > 1.5 && !tracks.isEmpty)
            alice.close()
            bob.close()
        } catch {
            check("https: \(error)", false)
        }
        return failures == 0 ? 0 : 1
    }
}
