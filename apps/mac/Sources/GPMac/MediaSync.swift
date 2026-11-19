// The files this device holds (docs/media-and-files.md, "Which files a device keeps"): what the core's
// `wantedMediaView` names, as the web's sync fetches it (`wantedBlobs`): every picture's and video's thumbnail, the
// themes', slideshows' and overlays' pictures, and, while a presentation is presented, its full pictures, audio,
// videos' stills and pages, fetched from the host into the media folder. A video itself is fetched when it plays
// (LivePlayer.swift). What arrives raises `mediaGeneration`, so a picture drawn without its file is drawn again.
import Foundation

extension AppState {
    /// Fetches what the core names and this device lacks, in its order; once at a time, again if asked meanwhile.
    func syncMedia() {
        guard case .synced = store else { return }
        if mediaRunning { mediaAgain = true; return }
        mediaRunning = true
        Task { @MainActor in
            repeat {
                mediaAgain = false
                struct Wanted: Decodable { let blobs: [String] }
                let policy: [String: Any] = ["presenting": live.id ?? NSNull(), "persistent": true, "keepComing": false, "today": localToday(), "days": 7]
                var arrived = 0
                for hash in view("wantedMediaView", policy, as: Wanted.self)?.blobs ?? [] where !MediaFiles.has(hash) {
                    guard await MediaFiles.file(hash, store: store) != nil else { continue }
                    arrived += 1
                    // A screenful at a time, so what is on screen fills in while the rest comes.
                    if arrived % 10 == 0 { mediaGeneration += 1 }
                }
                if arrived % 10 != 0 { mediaGeneration += 1 }
            } while mediaAgain
            mediaRunning = false
        }
    }
}
