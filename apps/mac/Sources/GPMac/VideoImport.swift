// A video imported (the web's media/video.ts): the work is the shell's (`SyncClient.importVideo`,
// Shell/MediaImports.swift: AVFoundation, the parts upload, `addVideo`), which apps/mac's `parity settings` runs against a
// server; here the line beside the button and the words of a refusal. And a library file opened to look at or hear (the
// web's Quick Look, its audio and video preview), a video streamed from the server's play address.
import AVKit
import Shell
import SwiftUI

enum VideoImport {
    /// The file imported, or why not in the web's words (`videos.failed…`); `state` the line beside the button.
    @MainActor static func run(_ url: URL, model: Model, state: @escaping (String) -> Void) async -> String? {
        let name = url.lastPathComponent
        guard case let .synced(client) = model.store else { return hostRefusal("no-server") }
        let result = await client.importVideo(url) { phase, percent in
            state(t(phase == "reading" ? "videos.reading" : "videos.uploading", ["name": name, "percent": percent]))
        }
        switch result {
        case .success:
            model.app.changed()
            return nil
        case let .failure(r):
            let key = ["type": "Type", "size": "Size", "name": "Name", "codec": "Codec", "decode": "Decode"][r.problem] ?? "Other"
            return t("videos.failed\(key)", ["name": name, "codec": r.codec ?? "?"])
        }
    }
}

/// A library file opened: a picture whole, a sound or a video to play (a video streamed from the server).
struct MediaPreview: View {
    @Environment(Model.self) private var model
    let kind: MediaKind
    let file: MediaFile
    @State private var player: AVPlayer?
    @State private var failed = false
    @State private var picture: URL?

    var body: some View {
        Group {
            switch kind {
            case .image:
                // Drawn once fetched (`picture`, set by load), or said when it could not be had.
                if let image = picture.flatMap(platformImage) { image.resizable().scaledToFit() }
                else if failed { Text(t("images.fetching")).foregroundStyle(.secondary) }
                else { ProgressView() }
            case .audio, .video:
                if let player { VideoPlayer(player: player).frame(minHeight: kind == .audio ? 80 : 300) }
                else if failed { Text(t("images.fetching")).foregroundStyle(.secondary) }
                else { ProgressView() }
            }
        }
        .padding()
        .sheetBar(file.fileName, confirm: t("common.close")) { true }
        .sheetSize(520, kind == .audio ? 200 : 380)
        .task { await load() }
        .onDisappear { player?.pause() }
    }

    private func load() async {
        switch kind {
        case .image:
            // The full picture, else the thumbnail where the full one is not to be had.
            if let url = await MediaFiles.file(file.fullHash ?? "", store: model.store) { picture = url }
            else if let h = file.thumbHash, let url = await MediaFiles.file(h, store: model.store) { picture = url }
            else { failed = true }
        case .audio:
            guard let url = await MediaFiles.file(file.hash ?? "", store: model.store) else { failed = true; return }
            player = AVPlayer(url: url)
            player?.play()
        case .video:
            guard case let .synced(client) = model.store, let hash = file.hash else { failed = true; return }
            // Held here, or from a host AVPlayer cannot reach itself (a self-signed one), the file played from the
            // media folder, as an item's preview plays it; else streamed from the server's play address.
            let held = FileManager.default.fileExists(atPath: AppScheme.mediaDir.appending(path: hash).path)
            if held || !client.streams {
                guard let url = await MediaFiles.file(hash, store: model.store) else { failed = true; return }
                player = AVPlayer(playerItem: AVPlayerItem(asset: AVURLAsset(url: url, options: file.contentType.map { [AVURLAssetOverrideMIMETypeKey: $0] } ?? [:])))
            } else {
                guard let url = await client.playURL(hash) else { failed = true; return }
                player = AVPlayer(url: url)
            }
            player?.play()
        }
    }
}
