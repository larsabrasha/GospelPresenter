// `parity present <sessions.json> <dir> <seconds>`: another computer presenting, for the UI test of remote control
// (apps/server/test/native-remote-ui.test.ts): Alice makes a presentation of a song and presents it with remote control
// allowed (Shell's LiveOwner), takes every command as her own change, and writes each to <dir>/applied.txt, for
// `seconds`; then ends.
import Foundation
import Shell

@MainActor
enum PresentCheck {
    static func run(_ sessionsFile: String, _ dir: String, _ seconds: Double) async -> Int32 {
        guard let data = FileManager.default.contents(atPath: sessionsFile),
              let sessions = try? JSONDecoder().decode([String: Session].self, from: data), let a = sessions["alice"],
              let alice = try? SyncClient(path: "\(dir)/presenter.sqlite", session: a) else { print("FAIL: no session"); return 1 }
        alice.start()
        for (name, args) in [
            ("createSong", ["id": "s1", "name": "Härlig är jorden"]),
            ("addSongPart", ["id": "s1-v", "songId": "s1", "labelText": NSNull(), "content": "Härlig är jorden"]),
            ("addSongPart", ["id": "s1-r", "songId": "s1", "labelText": NSNull(), "content": "Pilgrimsfärd"]),
            ("createPresentation", ["id": "p1", "name": "Söndag"]),
            ("addSongToPresentation", ["itemId": "i1", "presentationId": "p1", "songId": "s1", "arrangementId": NSNull()]),
            // For the UI test that presents on the device under test: a presentation of its own and a public output.
            ("createPresentation", ["id": "p2", "name": "Kvällsmöte"]),
            ("addSongToPresentation", ["itemId": "k1", "presentationId": "p2", "songId": "s1", "arrangementId": NSNull()]),
            ("createDisplay", ["id": "d1", "name": "Följ med", "code": "abcdefg", "kind": "public"]),
        ] as [(String, [String: Any])] { alice.mutate(name, args) }
        let start = Date()
        while alice.pendingCount > 0, Date().timeIntervalSince(start) < 10 { try? await Task.sleep(for: .milliseconds(50)) }
        let owner = LiveOwner(client: alice, session: a, deviceName: "Kyrkans dator")
        var rev = 1
        owner.onCommand = { change in
            rev += 1
            owner.follow(["presentationId": "p1", "itemId": change["itemId"] ?? NSNull(), "partIndex": change["partIndex"] ?? 0,
                          "black": change["black"] ?? false, "overlayId": NSNull(), "rev": rev])
            let line = "\(change["itemId"] ?? "")/\(change["partIndex"] ?? 0) black=\(change["black"] ?? false)\n"
            if let h = FileHandle(forWritingAtPath: "\(dir)/applied.txt") { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
            else { try? line.write(toFile: "\(dir)/applied.txt", atomically: true, encoding: .utf8) }
        }
        owner.remote = true
        owner.follow(["presentationId": "p1", "itemId": "i1", "partIndex": 0, "black": false, "overlayId": NSNull(), "rev": rev])
        print("ok: presenting")
        try? await Task.sleep(for: .seconds(seconds))
        owner.follow(nil)
        try? await Task.sleep(for: .milliseconds(300))
        return 0
    }
}
