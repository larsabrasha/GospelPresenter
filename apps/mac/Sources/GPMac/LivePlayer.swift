// The audio and video of what is shown, played on this device, the one presenting (spec 04 §1b, LIVE-R6; docs/live.md
// "Where audio and video play"; the web's Player, apps/web/src/live/player.ts): a video or audio item shown plays from
// its start, anything else shown stops it, Släck pauses it and the slide shown again plays on where it was, unless it
// was paused by hand. The next item's video is fetched meanwhile, so it starts at once. One AVPlayer: its sound plays
// here once, and every live picture of this device (the window's, the Mac's output window) shows its picture
// (VideoLayer). What the item is, its file and the next video are the core's (`livePlaybackView`, `itemAudioView`);
// the files come from the host to the media folder (MediaFiles).
import AVFoundation
import Observation
import Shell

@MainActor
@Observable
final class LivePlayer {
    @ObservationIgnored let player = AVPlayer()
    /// The item playing (or ready to), and whether it is a video or an audio file.
    private(set) var itemId: String?
    private(set) var kind: String?
    /// Its picture is ready to show over the still.
    private(set) var ready = false
    private(set) var playing = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    /// Tona ut under way.
    private(set) var fading = false

    @ObservationIgnored private var black = false
    /// Playing when Släck paused it: the slide shown again plays on.
    @ObservationIgnored private var playOnShow = false
    /// Pointers followed, so a file that comes late never plays over a newer one.
    @ObservationIgnored private var turn = 0
    @ObservationIgnored private var watchers: [NSKeyValueObservation] = []
    @ObservationIgnored private var clock: Any?
    @ObservationIgnored private var fade: Task<Void, Never>?

    init() {
        #if os(iOS)
        // Heard with the ringer silenced, as a presentation's sound must be.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        #endif
        player.actionAtItemEnd = .pause
        clock = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t) }
        }
        watchers.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            let on = p.timeControlStatus != .paused
            Task { @MainActor in self?.playing = on }
        })
    }

    private func tick(_ t: CMTime) {
        position = t.seconds.isFinite ? t.seconds : 0
        if let d = player.currentItem?.duration.seconds, d.isFinite { duration = d }
    }

    /// What the core says of the item shown: its kind, its video and the next item's.
    private struct Playback: Decodable {
        struct Item: Decodable { let id: String, type: String? }
        struct File: Decodable { let hash: String, contentType: String? }
        let item: Item?, video: File?, nextVideo: File?
    }

    /// The live state changed (or was read again): the item shown's audio or video, played as the rules say.
    func follow(_ app: AppState, _ state: LivePointer) {
        guard let pid = state.presentationId else { stop(); return }
        let shown = app.view("livePlaybackView", ["presentationId": pid, "itemId": state.itemId ?? NSNull()], as: Playback.self)
        let item = shown?.item
        // The same item shown again (another of its slides, a pull, Släck): it plays on, or is paused by Släck.
        if let item, item.id == itemId {
            setBlack(state.black)
            return
        }
        stop()
        black = state.black
        let file: Playback.File? = switch item?.type {
        case "video": shown?.video
        case "audio": app.view("itemAudioView", ["itemId": item?.id ?? ""], as: Playback.File.self)
        default: nil
        }
        if let next = shown?.nextVideo { Task { _ = await MediaFiles.file(next.hash, store: app.store) } }
        guard let item, let file else { return }
        itemId = item.id
        kind = item.type
        turn += 1
        let mine = turn
        Task {
            guard let url = await MediaFiles.file(file.hash, store: app.store), mine == turn else { return }
            load(url, type: file.contentType)
        }
    }

    private func load(_ url: URL, type: String?) {
        // A file kept by its hash has no extension: its type said, so AVFoundation reads it.
        let asset = AVURLAsset(url: url, options: type.map { [AVURLAssetOverrideMIMETypeKey: $0] } ?? [:])
        let item = AVPlayerItem(asset: asset)
        watchers.append(item.observe(\.status, options: [.new]) { [weak self] i, _ in
            let ok = i.status == .readyToPlay
            Task { @MainActor in self?.ready = ok }
        })
        player.replaceCurrentItem(with: item)
        player.seek(to: .zero)
        // Shown while black (a video item made live under Släck): it waits for the picture.
        if black { playOnShow = true } else { player.play() }
    }

    /// Släck pauses what plays; the picture shown again plays it on where it was, unless it was paused by hand.
    private func setBlack(_ on: Bool) {
        guard on != black else { return }
        black = on
        if on {
            playOnShow = player.timeControlStatus != .paused
            player.pause()
        } else if playOnShow {
            playOnShow = false
            player.play()
        }
    }

    /// Nothing to play: stopped, its file let go.
    func stop() {
        turn += 1
        fade?.cancel()
        fade = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        player.volume = 1
        watchers = Array(watchers.prefix(1))
        (itemId, kind, ready, fading, position, duration, playOnShow) = (nil, nil, false, false, 0, 0, false)
    }

    // ------------------------------------------------------------ the controls

    func toggle() {
        if player.timeControlStatus == .paused {
            // At its end, it plays from its start.
            if duration > 0, position >= duration - 0.05 { player.seek(to: .zero) }
            player.play()
        } else {
            player.pause()
        }
    }

    func seek(_ seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        position = seconds
    }

    /// Tona ut: the volume down over 5 s, easing out (a cubic), then paused, back at the start, at full volume again
    /// (spec 04 §1b).
    func fadeOut() {
        guard fade == nil, player.timeControlStatus != .paused else { return }
        fading = true
        let from = player.volume
        fade = Task { @MainActor in
            let steps = 100
            for n in 1...steps {
                try? await Task.sleep(for: .milliseconds(50)) // 100 steps of 50 ms: the spec's 5 000 ms
                if Task.isCancelled { return }
                let k = Double(n) / Double(steps)
                player.volume = from * Float(1 - (1 - pow(1 - k, 3)))
            }
            player.pause()
            await player.seek(to: .zero)
            player.volume = 1
            position = 0
            fading = false
            fade = nil
        }
    }
}

/// The media files of this device, kept by their hash in the app's media folder (where `gp://media` reads pictures),
/// fetched from the host when first wanted and not yet here; nil while there is none (no host, or not on it).
@MainActor
enum MediaFiles {
    private static var fetching: [String: Task<URL?, Never>] = [:]

    static func file(_ hash: String, store: Store?) async -> URL? {
        let url = AppScheme.mediaDir.appending(path: hash)
        if FileManager.default.fileExists(atPath: url.path) { return url }
        if let running = fetching[hash] { return await running.value }
        guard case let .synced(client) = store else { return nil }
        try? FileManager.default.createDirectory(at: AppScheme.mediaDir, withIntermediateDirectories: true)
        let task = Task { await client.media(hash, to: url) ? url : nil }
        fetching[hash] = task
        defer { fetching[hash] = nil }
        return await task.value
    }
}
