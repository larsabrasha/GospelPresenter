// `parity sync <sessions.json> <dir>`: the native shell's sync (Sync.swift, doing what the core's sync driver says)
// against a real server, run by apps/server/test/native-sync.test.ts. Two devices of one organisation each open a
// database in <dir> and start their poke socket; a change on one reaches the other through a poke, and back; a device
// whose credentials the server refuses stops syncing. One line a step, "ok" or "FAIL"; the exit code is the failures.
import Foundation
import Shell

@MainActor
enum SyncCheck {
    static func run(_ sessionsFile: String, _ dir: String) async -> Int32 {
        guard let data = FileManager.default.contents(atPath: sessionsFile),
              let sessions = try? JSONDecoder().decode([String: Session].self, from: data),
              let a = sessions["alice"], let b = sessions["bob"], let stranger = sessions["stranger"] else {
            print("FAIL: no sessions in \(sessionsFile)")
            return 1
        }
        var failures: Int32 = 0
        func check(_ what: String, _ ok: Bool) {
            print("\(ok ? "ok" : "FAIL"): \(what)")
            if !ok { failures += 1 }
        }
        /// Waits until `done` holds, at most `seconds`: the milliseconds it took, or nil.
        func wait(_ seconds: Double, _ done: () -> Bool) async -> Int? {
            let start = Date()
            while Date().timeIntervalSince(start) < seconds {
                if done() { return Int(Date().timeIntervalSince(start) * 1000) }
                try? await Task.sleep(for: .milliseconds(10))
            }
            return nil
        }
        func name(_ c: SyncClient, _ id: String) -> String? {
            if case let .text(n)? = (try? c.core.db.query("SELECT name FROM presentations WHERE id = ?", [.text(value: id)]))?.first?.first { return n }
            return nil
        }
        do {
            let alice = try SyncClient(path: "\(dir)/alice.sqlite", session: a)
            let bob = try SyncClient(path: "\(dir)/bob.sqlite", session: b)
            alice.start()
            bob.start()
            let settled = await wait(5) { alice.connected && bob.connected && !alice.busy && !bob.busy }
            check("both connect and catch up", settled != nil)

            alice.mutate("createPresentation", ["id": "N1", "name": "Från Swift"])
            let reached = await wait(5) { name(bob, "N1") == "Från Swift" }
            check("a change reaches the other device through a poke (\(reached.map { "\($0) ms" } ?? "never"))", reached != nil)
            check("the queue is empty once the server took it", await wait(5) { alice.pendingCount == 0 && !alice.busy } != nil)

            bob.mutate("renamePresentation", ["id": "N1", "name": "Omdöpt"])
            let back = await wait(5) { name(alice, "N1") == "Omdöpt" }
            check("and one back (\(back.map { "\($0) ms" } ?? "never"))", back != nil)

            let refused = try SyncClient(path: "\(dir)/stranger.sqlite", session: stranger)
            refused.mutate("createPresentation", ["id": "X", "name": "Utan behörighet"])
            let stopped = await wait(5) { refused.stopped != nil && !refused.busy }
            check("refused credentials stop syncing (\(String(describing: refused.stopped)))", stopped != nil && refused.stopped == .signedOut("unauthenticated"))
            check("and the queue is kept", refused.pendingCount == 1)

            alice.close()
            check("closing closes the socket", await wait(2) { !alice.connected } != nil)
            bob.close()
        } catch {
            check("open: \(error)", false)
        }
        return failures
    }
}
