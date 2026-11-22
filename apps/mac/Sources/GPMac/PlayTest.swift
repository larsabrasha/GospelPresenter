// GP_MAC_PLAYTEST=<file> (with GP_MAC_DATA's demo, and the demo's video and audio files in its media folder under
// their hashes): the player's rules run on the demo's main presentation, what the player says after each step written
// to <file>, then the app quits. Checks what no screen is needed for: a video item shown plays from its start, Släck
// pauses it and the slide shown again plays on (Släck is lifted by a slide shown), another item stops it, an audio item
// plays, Tona ut pauses it at its start. Muted. Not what the picture looks like, nor what is heard.
#if os(macOS)
import AppKit
import SwiftUI

@MainActor
enum PlayTest {
    static func run(_ model: Model, out: String) async {
        let player = model.app.player
        // Silent: the checks read the player's state, not the room's ears (its volume, which Tona ut turns, apart).
        player.player.isMuted = true
        let media = player.media
        var lines: [String] = []
        func note(_ step: String) {
            lines.append(String(format: "%@: black %@, item %@, %@, ready %@, playing %@, at %.2f s of %.2f s, volume %.2f", step, String(model.live.state.black),
                                player.itemId ?? "none", player.kind ?? "-", String(media.ready), String(media.playing), media.position, media.duration,
                                player.player.volume))
        }
        func wait(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }
        model.path = ["pres-main"]
        model.send(["type": "start"])
        model.send(["type": "show", "itemId": "pres-main-i4", "partIndex": 0])
        await wait(2)
        note("video shown, 2 s on")
        let again: [String: Any] = ["type": "show", "itemId": "pres-main-i4", "partIndex": 0]
        model.send(["type": "black"])
        await wait(1)
        note("Släck, 1 s on")
        model.send(again)
        await wait(1)
        note("shown again, 1 s on")
        media.toggle()
        await wait(0.5)
        note("paused by hand")
        model.send(["type": "black"])
        model.send(again)
        await wait(0.5)
        note("Släck and back while paused by hand")
        model.send(["type": "show", "itemId": "pres-main-i5", "partIndex": 0])
        await wait(2)
        note("audio shown, 2 s on")
        media.fadeOut { model.view("fadeOutView", ["from": $0, "elapsedMs": $1], as: FadeStep.self) }
        await wait(2.5)
        note("Tona ut, 2.5 s on")
        await wait(3)
        note("Tona ut, 5.5 s on")
        model.send(["type": "show", "itemId": "pres-main-i1", "partIndex": 0])
        await wait(0.5)
        note("a song shown")
        try? lines.joined(separator: "\n").write(toFile: out, atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }
}
#endif
