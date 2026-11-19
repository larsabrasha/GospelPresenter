// The audio and video of what is shown, played on this device, the one presenting (spec 04 §1b, LIVE-R6; docs/live.md
// "Where audio and video play"; the web's Player, apps/web/src/live/player.ts): a video or audio item shown plays from
// its start, anything else shown stops it, Släck pauses it and the slide shown again plays on where it was, unless it
// was paused by hand, as the core says (`playbackStepView`); this does what it says. The next item's video is fetched
// meanwhile, so it starts at once. One player: its sound plays here once, and every live picture of this device (the
// window's, the Mac's output window) shows its picture (VideoLayer). What the item is, its file and the next video are the core's (`livePlaybackView`, `itemAudioView`);
// the files come from the host to the media folder (MediaFiles). MediaPlayer plays one file with the controls, here
// and in an item's preview before presenting (ItemPreview).
import AVFoundation
import Observation
import Shell

/// One file played, with what its controls show and do: play or pause, the position, Tona ut.
@MainActor
@Observable
final class MediaPlayer {
    @ObservationIgnored let player = AVPlayer()
    /// Its picture is ready to show.
    private(set) var ready = false
    private(set) var playing = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    /// Tona ut under way.
    private(set) var fading = false
    @ObservationIgnored private var watchers: [NSKeyValueObservation] = []
    @ObservationIgnored private var itemWatch: NSKeyValueObservation?
    @ObservationIgnored private var fade: Task<Void, Never>?

    init() {
        #if os(iOS)
        // Heard with the ringer silenced, as a presentation's sound must be.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        #endif
        player.actionAtItemEnd = .pause
        player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] t in
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

    /// A file from its start; played at once unless `play` is false. A file kept by its hash has no extension: its
    /// type said, so AVFoundation reads it.
    func load(_ url: URL, type: String?, play: Bool) {
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: type.map { [AVURLAssetOverrideMIMETypeKey: $0] } ?? [:]))
        itemWatch = item.observe(\.status, options: [.new]) { [weak self] i, _ in
            let ok = i.status == .readyToPlay
            Task { @MainActor in self?.ready = ok }
        }
        player.replaceCurrentItem(with: item)
        player.seek(to: .zero)
        if play { player.play() }
    }

    /// Nothing loaded.
    func stop() {
        fade?.cancel()
        fade = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        player.volume = 1
        itemWatch = nil
        (ready, fading, position, duration) = (false, false, 0, 0)
    }

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

@MainActor
@Observable
final class LivePlayer {
    let media = MediaPlayer()
    var player: AVPlayer { media.player }
    /// The item playing (or ready to), and whether it is a video or an audio file.
    private(set) var itemId: String?
    private(set) var kind: String?

    /// What the player holds, as the core keeps count of it (`playbackStepView`).
    private struct Held: Codable { var itemId: String?, black = false, playing = false, playOnShow = false }
    @ObservationIgnored private var held = Held()
    /// Pointers followed, so a file that comes late never plays over a newer one.
    @ObservationIgnored private var turn = 0

    /// What the core says of the item shown: its kind, its video and the next item's.
    private struct Playback: Decodable {
        struct Item: Decodable { let id: String, type: String? }
        struct File: Decodable { let hash: String, contentType: String? }
        let item: Item?, video: File?, nextVideo: File?
    }

    /// What to do, as the core works it out.
    private struct Step: Decodable { let `do`: String, itemId: String?, kind: String?, play: Bool? }
    private struct Answer: Decodable { let player: Held, steps: [Step] }

    /// The live state changed (or was read again): the core says what the player does with the item shown's audio or
    /// video (`playbackStepView`), given what it holds and whether it plays; this does it.
    func follow(_ app: AppState, _ state: LivePointer) {
        let shown = state.presentationId.flatMap { app.view("livePlaybackView", ["presentationId": $0, "itemId": state.itemId ?? NSNull()], as: Playback.self) }
        var now = held
        now.playing = player.timeControlStatus != .paused
        let item: Any = shown?.item.map { ["id": $0.id, "type": $0.type.map { $0 as Any } ?? NSNull()] as [String: Any] } ?? NSNull()
        let holds: [String: Any] = ["itemId": now.itemId.map { $0 as Any } ?? NSNull(), "black": now.black, "playing": now.playing, "playOnShow": now.playOnShow]
        let args: [String: Any] = ["player": holds, "presentationId": state.presentationId.map { $0 as Any } ?? NSNull(), "item": item, "black": state.black]
        guard let answer = app.view("playbackStepView", args, as: Answer.self) else { return }
        held = answer.player
        if let next = shown?.nextVideo { Task { _ = await MediaFiles.file(next.hash, store: app.store) } }
        for step in answer.steps {
            switch step.do {
            case "stop":
                turn += 1
                media.stop()
                (itemId, kind) = (nil, nil)
            case "load":
                guard let id = step.itemId else { continue }
                let file: Playback.File? = step.kind == "video" ? shown?.video : app.view("itemAudioView", ["itemId": id], as: Playback.File.self)
                (itemId, kind) = (id, step.kind)
                turn += 1
                let mine = turn
                guard let file else { continue }
                Task {
                    guard let url = await MediaFiles.file(file.hash, store: app.store), mine == turn else { return }
                    // Played as the core last said: a picture shown again while the file came plays it.
                    media.load(url, type: file.contentType, play: held.playing && held.itemId == id)
                }
            case "pause": player.pause()
            case "play": player.play()
            default: break
            }
        }
    }

    /// Nothing to play: stopped, its file let go.
    func stop() {
        turn += 1
        media.stop()
        (itemId, kind, held) = (nil, nil, Held())
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

    /// Whether this device has the file.
    static func has(_ hash: String) -> Bool { FileManager.default.fileExists(atPath: AppScheme.mediaDir.appending(path: hash).path) }
}
