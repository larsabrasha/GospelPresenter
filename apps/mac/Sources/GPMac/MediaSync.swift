// The files this device holds (docs/media-and-files.md, "Which files a device keeps"), as the core's `mediaPlanView`
// says for every shell (the web's syncMedia): what it names and this device lacks is fetched from the host into the
// media folder, in its order, each checked against its hash (`SyncClient.media`); what nothing names after the grace,
// and the oldest of what nothing wants now while that is over the budget, is removed. Every picture's and video's
// thumbnail, the themes', slideshows' and overlays' pictures, and, while a presentation is presented, its full
// pictures, audio, videos' stills and pages. A video itself is fetched when it plays (LivePlayer.swift), and is cache
// afterwards. What arrives raises `mediaGeneration`, so a picture drawn without its file is drawn again.
import Foundation

extension AppState {
    /// The most bytes kept of files nothing wants now (MEDIA-R14: 2 GiB), as on the web.
    static let mediaBudget = 2 * 1024 * 1024 * 1024

    /// Fetches and removes what the core says; once at a time, again if asked meanwhile.
    func syncMedia() {
        guard case .synced = store else { return }
        if mediaRunning { mediaAgain = true; return }
        mediaRunning = true
        Task { @MainActor in
            repeat {
                mediaAgain = false
                struct Plan: Decodable { let fetch: [String], drop: [String] }
                // Listed off the main thread: a church's folder holds thousands of files.
                let dir = AppScheme.mediaDir
                let held = await Task.detached { MediaFiles.held(in: dir) }.value
                let policy: [String: Any] = [
                    "presenting": live.id ?? NSNull(), "persistent": true, "keepComing": false, "today": localToday(), "days": 7,
                    "budget": Self.mediaBudget, "now": Int(Date().timeIntervalSince1970 * 1000),
                    "held": held.map { ["hash": $0.hash, "size": $0.size, "at": $0.at] as [String: Any] },
                    // The player's videos, the next item's fetched in advance too: never dropped while it needs them.
                    "inUse": Array(player.inUse),
                ]
                guard let plan = view("mediaPlanView", policy, as: Plan.self) else { break }
                for hash in plan.drop { MediaFiles.remove(hash) }
                var arrived = 0
                for hash in plan.fetch {
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

/// A file of the media folder as the core takes it: its hash (its name), its size and its time in milliseconds.
struct HeldFile: Sendable { let hash: String, size: Int, at: Int }

extension MediaFiles {
    /// The files of the media folder `dir`.
    nonisolated static func held(in dir: URL) -> [HeldFile] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys)) ?? []
        return files.compactMap { url in
            guard let v = try? url.resourceValues(forKeys: Set(keys)), let size = v.fileSize else { return nil }
            return HeldFile(hash: url.lastPathComponent, size: size, at: Int((v.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000))
        }
    }

    /// Removes a file of the media folder (a player that has it open plays on: the file goes once it is closed).
    static func remove(_ hash: String) {
        try? FileManager.default.removeItem(at: AppScheme.mediaDir.appending(path: hash))
    }
}
