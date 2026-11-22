// An audio or video item before presenting, as the web shows it (apps/web/src/pages/presentation-editor/ItemParts.tsx,
// `ItemMedia`): an audio item's file name and its own player, which plays here only and stops when the item is left;
// a video item's still with a player that plays it. The file is fetched when it is first wanted, as Quick Look does: a
// device keeps by itself only the files of a presentation presented (MediaSync.swift). And the speaker over an audio
// item's slide (the web's AudioMark).
import AVKit
import SwiftUI
import UniformTypeIdentifiers

/// Before presenting, an audio or video item's preview; nothing for other items.
struct ItemPreview: View {
    let item: ItemView

    var body: some View {
        if let audio = item.audio {
            AudioPreview(file: audio).id(audio.hash)
        } else if let video = item.video {
            VideoPreview(file: video).id(video.hash)
        }
    }
}

/// An audio file's name and player, once this device has the file, fetched now when it lacks it.
private struct AudioPreview: View {
    @Environment(Model.self) private var model
    let file: AudioFile
    @State private var media = MediaPlayer()
    /// nil while it comes; false if it cannot be had.
    @State private var here: Bool?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(file.fileName).font(.subheadline.weight(.medium)).lineLimit(1)
            switch here {
            case true?: MediaControls(media: media, kind: "audio")
            case false?: Text(t("common.error")).font(.subheadline).foregroundStyle(Color.quiet)
            case nil: Text(t("presentation.audioFetching")).font(.subheadline).foregroundStyle(Color.quiet)
            }
        }
        .padding(.vertical, 6)
        .task {
            guard let url = await MediaFiles.file(file.hash, store: model.app.store) else { here = false; return }
            // Its type by its name's ending, as the file kept by its hash has none.
            let type = UTType(filenameExtension: (file.fileName as NSString).pathExtension)?.preferredMIMEType
            media.load(url, type: type, play: false)
            here = true
        }
        .onDisappear { media.stop() }
    }
}

/// A video item's still, and the system's player over it once played; the file fetched when it is played.
private struct VideoPreview: View {
    @Environment(Model.self) private var model
    let file: VideoFile
    @State private var player: AVPlayer?
    @State private var fetching = false

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
            } else {
                Color.black
                if let still = file.stillHash.flatMap(SlideFaces.picture) ?? file.thumbHash.flatMap(SlideFaces.picture) {
                    Image(decorative: still, scale: 1).resizable().scaledToFit()
                }
                Button { play() } label: {
                    Image(systemName: fetching ? "hourglass" : "play.circle.fill").font(.system(size: 44)).foregroundStyle(.white).shadow(radius: 3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t("video.play"))
                .disabled(fetching)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: 512)
        .padding(.vertical, 6)
        .onDisappear { player?.pause() }
    }

    private func play() {
        fetching = true
        Task {
            defer { fetching = false }
            guard let url = await MediaFiles.file(file.hash, store: model.app.store) else { return }
            let p = AVPlayer(playerItem: AVPlayerItem(asset: AVURLAsset(url: url, options: file.contentType.map { [AVURLAssetOverrideMIMETypeKey: $0] } ?? [:])))
            player = p
            p.play()
        }
    }
}

/// The speaker over an audio item's slide, and on a tile its file's name (the web's AudioMark).
struct AudioMark: View {
    let slide: Slide
    var small = false

    var body: some View {
        if let name = slide.audioName {
            VStack(spacing: 8) {
                Image(systemName: "speaker.wave.2.fill").font(small ? .title3 : .largeTitle)
                if !small { Text(name).font(.subheadline).lineLimit(1) }
            }
            .foregroundStyle(.white)
            .shadow(radius: 2)
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
        }
    }
}
