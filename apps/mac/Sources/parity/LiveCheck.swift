// `parity live <sessions.json> <dir>`: the native app as the owner of a live session against a real server, run by
// apps/server/test/native-live.test.ts. Alice presents a song with a public output chosen (Shell's LiveOwner): Bob, a
// member, sees her session with its pointer and output; a viewer of the public output gets the slide's words; Bob's
// command, with remote control allowed, is taken and applied; Avsluta ends the session. One line a step, "ok" or
// "FAIL"; the exit code is the failures.
import Foundation
import Shell

@MainActor
enum LiveCheck {
    static func run(_ sessionsFile: String, _ dir: String) async -> Int32 {
        guard let data = FileManager.default.contents(atPath: sessionsFile),
              let sessions = try? JSONDecoder().decode([String: Session].self, from: data),
              let a = sessions["alice"], let b = sessions["bob"], let server = try? Server(a.server) else {
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
        do {
            let alice = try SyncClient(path: "\(dir)/alice.sqlite", session: a)
            alice.start()
            check("connects", await wait(5) { alice.connected && !alice.busy })
            for (name, args) in [
                ("createSong", ["id": "s1", "name": "Härlig är jorden"]),
                ("addSongPart", ["id": "s1-v", "songId": "s1", "labelText": NSNull(), "content": "Härlig är jorden, härlig är Guds himmel"]),
                ("addSongPart", ["id": "s1-r", "songId": "s1", "labelText": NSNull(), "content": "Pilgrimsfärd"]),
                ("createPresentation", ["id": "p1", "name": "Söndag"]),
                ("addSongToPresentation", ["itemId": "i1", "presentationId": "p1", "songId": "s1", "arrangementId": NSNull()]),
                ("createDisplay", ["id": "d1", "name": "Följ med", "code": "abcdefg", "kind": "public"]),
            ] as [(String, [String: Any])] {
                let refused = alice.mutate(name, args)
                check("\(name) taken (\(refused?.code ?? "ok"))", refused == nil)
            }
            check("pushed", await wait(10) { alice.pendingCount == 0 && !alice.busy && alice.rejected.isEmpty })

            let owner = LiveOwner(client: alice, session: a, deviceName: "Macen")
            var applied: [[String: Any]] = []
            owner.onCommand = { applied.append($0) }
            owner.setOutput("d1", on: true)
            owner.follow(["presentationId": "p1", "itemId": "i1", "partIndex": 0, "black": false, "overlayId": NSNull(), "rev": 1])

            let bob = LiveStatus()
            var bobHeard: [[String: Any]] = []
            bob.onMessage = { bobHeard.append($0) }
            bob.start(b)
            let mine = { () -> [String: Any]? in bob.sessions.compactMap { $0 as? [String: Any] }.first { $0["id"] as? String == owner.sessionId } }
            check("a member sees the session with its pointer and output", await wait(10) {
                guard let s = mine(), let p = s["pointer"] as? [String: Any] else { return false }
                return p["itemId"] as? String == "i1" && s["deviceName"] as? String == "Macen" && s["presentationName"] as? String == "Söndag"
                    && (s["outputs"] as? [[String: Any]] ?? []).contains { $0["id"] as? String == "d1" }
            })

            // A viewer of the public output: the slide's words in its stream.
            var heard = ""
            let viewer = Task {
                guard let url = URL(string: "\(a.server)/api/watch/abcdefg/stream?v=0123456789abcdef"),
                      let (bytes, _) = try? await URLSession.shared.bytes(from: url) else { return }
                for try await line in bytes.lines where line.hasPrefix("data:") {
                    heard += line
                    if line.contains("Härlig är jorden") { return }
                }
            }
            check("the public output shows the slide's words", await wait(10) { heard.contains("Härlig är jorden") })
            viewer.cancel()

            // Remote control allowed: Bob drives it (Shell's LiveController), his click shown at once, the owner takes the
            // command and applies it as its own change, and the echo confirms it.
            owner.remote = true
            check("the session allows remote control", await wait(5) { mine()?["remote"] as? Bool == true })
            owner.onCommand = { change in
                applied.append(change)
                owner.follow(["presentationId": "p1", "itemId": change["itemId"] ?? NSNull(), "partIndex": change["partIndex"] ?? 0,
                              "black": change["black"] ?? false, "overlayId": NSNull(), "rev": 2])
            }
            let bobClient = try SyncClient(path: "\(dir)/bob.sqlite", session: b)
            let control = LiveController(link: bob, sessionId: owner.sessionId, client: bobClient)
            var unconfirmed = 0
            control.onUnconfirmed = { unconfirmed += 1 }
            control.set(["partIndex": 1])
            check("a controller's click shows at once", control.shown().pointer["partIndex"] as? Int == 1)
            check("the owner takes the command", await wait(5) { applied.first?["partIndex"] as? Int == 1 })
            check("the owner's echo confirms it", await wait(5) { control.shown().confirmed || (mine()?["pointer"] as? [String: Any])?["partIndex"] as? Int == 1 })
            // Remote control off: a command is not taken, and after 2 s the controller says so once.
            owner.remote = false
            check("remote control off", await wait(5) { mine()?["remote"] as? Bool == false })
            control.set(["partIndex": 0])
            check("a command not taken is said once after 2 s", await wait(4) { unconfirmed == 1 })
            check("and not applied", applied.count == 1)

            owner.follow(nil)
            check("Avsluta ends the session", await wait(5) { mine() == nil })
            bob.stop()
            owner.link.stop()
            _ = server
        } catch {
            check("set up (\(error))", false)
        }
        return failures
    }
}
