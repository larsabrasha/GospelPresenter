// The live picture with its video, and the player's controls (LivePlayer.swift): a video plays over its slide's still
// and under the overlay, as SlideView lays them (`slide-image`, then `.slide-overlay`); the controls under the live
// picture, as the web's VideoPlayer and AudioPlayer under the item's slide (spec 04 §1b).
import AVFoundation
import SwiftUI

/// The live picture and the output: painted from the core's layout where it lays the slide out, else SlideView in a
/// web view of its own; `video`, a video playing for this slide, between the slide and its overlay.
struct LiveSlide: View {
    let tile: TileRequest
    var video: AVPlayer? = nil

    var body: some View {
        if let layout = SlidePainter.layout(tile) {
            ZStack {
                painted(layout, video == nil ? .all : .slide)
                if let video {
                    VideoLayer(player: video)
                    painted(layout, .overlay)
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
        } else {
            LiveWebView(tile: tile)
        }
    }

    private func painted(_ layout: SlideLayout, _ part: SlidePainter.Part) -> some View {
        Canvas { gc, size in
            gc.withCGContext { ctx in MainActor.assumeIsolated { SlidePainter.paint(layout, label: nil, in: ctx, size: size, part: part) } }
        }
    }
}

/// A video's picture, fitted to its box (`object-fit: contain`), from the one player every live picture shares.
#if os(iOS)
struct VideoLayer: UIViewRepresentable {
    let player: AVPlayer
    final class View: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var video: AVPlayerLayer { layer as! AVPlayerLayer }
    }
    func makeUIView(context: Context) -> View {
        let v = View()
        v.video.videoGravity = .resizeAspect
        v.isUserInteractionEnabled = false
        return v
    }
    func updateUIView(_ v: View, context: Context) { if v.video.player !== player { v.video.player = player } }
}
#else
struct VideoLayer: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        let layer = AVPlayerLayer(player: player)
        layer.videoGravity = .resizeAspect
        v.layer = layer
        v.wantsLayer = true
        return v
    }
    func updateNSView(_ v: NSView, context: Context) {
        if let layer = v.layer as? AVPlayerLayer, layer.player !== player { layer.player = player }
    }
}
#endif

extension LivePlayer {
    /// The player for the live picture of `item`'s slide: while its video is ready to show.
    func video(for item: String?) -> AVPlayer? { kind == "video" && media.ready && item != nil && item == itemId ? player : nil }
}

/// Under the live picture while a video or audio item is live: its controls.
struct PlayerBar: View {
    @Environment(Model.self) private var model

    var body: some View {
        let live = model.app.player
        if let kind = live.kind, live.itemId == model.live.state.itemId { MediaControls(media: live.media, kind: kind) }
    }
}

/// A file's controls: play or pause, the position to drag, the time, and an audio file's Tona ut (the web's
/// PlayerControls and AudioPlayer), each as the core says (`playerControlsView`, `fadeOutView`).
struct MediaControls: View {
    @Environment(Model.self) private var model
    let media: MediaPlayer
    let kind: String

    var body: some View {
        let args: [String: Any] = ["kind": kind, "playing": media.playing, "position": media.position, "duration": media.duration, "fading": media.fading]
        if let c = model.view("playerControlsView", args, as: PlayerControls.self) {
            HStack(spacing: 12) {
                Button { media.toggle() } label: {
                    Image(systemName: c.icon == "pause" ? "pause.fill" : "play.fill").frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t(c.toggle))
                Slider(value: Binding(get: { media.position }, set: { media.seek($0) }), in: 0...c.end)
                    .accessibilityLabel(t(c.seek))
                Text(c.time).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                if let fade = c.fade {
                    Button(t(fade.text)) { media.fadeOut { model.view("fadeOutView", ["from": $0, "elapsedMs": $1], as: FadeStep.self) } }
                        .disabled(!fade.enabled)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}
