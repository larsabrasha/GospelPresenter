// `parity settings <sessions.json> <dir>`: what the native Inställningar does against a real server, run by
// apps/server/test/native-settings.test.ts. A file imported on one device goes up before the change naming it is pushed
// (SyncClient.uploadBeforePush) and reaches the other; a Bible imported here goes up with its text; the endpoints the
// pages read answer what they decode; and an organisation exported by the core's plan is imported into another one.
// One line a step, "ok" or "FAIL"; the exit code is the failures.
import CryptoKit
import Foundation
import Shell

@MainActor
enum SettingsCheck {
    static func run(_ sessionsFile: String, _ dir: String) async -> Int32 {
        guard let data = FileManager.default.contents(atPath: sessionsFile),
              let sessions = try? JSONDecoder().decode([String: Session].self, from: data),
              let a = sessions["alice"], let b = sessions["bob"], let c = sessions["carol"], let server = try? Server(a.server) else {
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
        func json(_ method: String, _ path: String, _ body: Any? = nil, as s: Session) async -> (Int, Any?) {
            guard let r = try? await server.request(method, path, json: body.map { Core.json($0) }, as: s) else { return (0, nil) }
            return (r.status, try? JSONSerialization.jsonObject(with: r.body, options: .fragmentsAllowed))
        }
        let sha = { (d: Data) in SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }
        do {
            let media = URL(filePath: dir).appending(path: "media")
            try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
            let alice = try SyncClient(path: "\(dir)/alice.sqlite", session: a)
            alice.mediaDir = media
            let bob = try SyncClient(path: "\(dir)/bob.sqlite", session: b)
            alice.start()
            bob.start()
            check("both connect", await wait(5) { alice.connected && bob.connected && !alice.busy && !bob.busy })

            // A sound imported here: kept in the media folder by its hash, recorded, and named by addAudio.
            var sound = Data("ID3".utf8)
            sound.append(contentsOf: (0..<2000).map { UInt8(truncatingIfNeeded: $0 * 13) })
            let hash = sha(sound)
            try sound.write(to: media.appending(path: hash))
            alice.recordBlob(hash, contentType: "audio/mpeg", size: sound.count)
            let refused = alice.mutate("addAudio", ["id": "A1", "fileName": "Intro.mp3", "contentType": "audio/mpeg", "hash": hash, "size": sound.count, "createdAt": 1000])
            check("addAudio taken here (\(refused?.code ?? "ok"))", refused == nil)
            check("pushed, the sound uploaded before it", await wait(10) { alice.pendingCount == 0 && !alice.busy && alice.rejected.isEmpty })
            let back = URL(filePath: dir).appending(path: "back")
            check("the server has the sound's bytes", await bob.media(hash, to: back) && (try? Data(contentsOf: back)) == sound)
            check("the other device has the sound", await wait(5) { (try? bob.core.db.query("SELECT 1 FROM audios WHERE id = 'A1'"))?.isEmpty == false })

            // A Bible imported here: its text kept and the translation marked kept, then importBible; the text goes up first.
            let text = #"{"v":1,"books":[{"code":"PSA","verses":[[23,1,"Herren är min herde"]]}]}"#
            let textHash = sha(Data(text.utf8))
            check("the imported text is kept here", alice.keepImported("bible:ps", hash: textHash, json: text))
            let imported = alice.mutate("importBible", ["name": "Psalmerna", "abbreviation": "PS", "language": "sv", "contentHash": textHash])
            check("importBible taken (\(imported?.code ?? "ok"))", imported == nil)
            check("pushed, its text uploaded before it", await wait(10) { alice.pendingCount == 0 && !alice.busy && alice.rejected.isEmpty })
            let (textStatus, _) = await json("GET", "/api/bibles/\(textHash)", as: b)
            check("the server has the text (\(textStatus))", textStatus == 200)

            // The endpoints the pages read, answering what they decode.
            let (usersStatus, users) = await json("GET", "/api/users", as: a)
            let firstUser = (users as? [[String: Any]])?.first
            check("Användare: GET /api/users (\(usersStatus))", usersStatus == 200 && firstUser?["id"] is String && firstUser?["active"] is Bool && firstUser?["role"] is String)
            let (inviteStatus, invite) = await json("POST", "/api/invitations", ["email": "ny@exempel.se", "role": "user", "language": "sv"], as: a)
            let inviteId = (invite as? [String: Any])?["id"] as? String
            check("Bjud in: POST /api/invitations (\(inviteStatus))", inviteStatus == 200 && inviteId != nil && ((invite as? [String: Any])?["inviteToken"] is String || (invite as? [String: Any])?["mailed"] as? Bool == true))
            let (listStatus, list) = await json("GET", "/api/invitations", as: a)
            check("Inbjudna: GET /api/invitations lists it (\(listStatus))", ((list as? [[String: Any]]) ?? []).contains { $0["id"] as? String == inviteId && $0["expiresAt"] is NSNumber })
            let (withdrawn, _) = await json("DELETE", "/api/invitations/\(inviteId ?? "")", as: a)
            check("Dra tillbaka: DELETE /api/invitations/{id} (\(withdrawn))", (200..<300).contains(withdrawn))
            let (meStatus, me) = await json("GET", "/api/auth/me", as: a)
            let m = me as? [String: Any]
            check("Profil: GET /api/auth/me (\(meStatus))", meStatus == 200 && m?.keys.contains("email") == true && m?["emailConfirmed"] is Bool && m?["superAdmin"] is Bool)
            let (renamed, _) = await json("PATCH", "/api/auth/me", ["name": "Alice Svensson"], as: a)
            check("Namn: PATCH /api/auth/me (\(renamed))", (200..<300).contains(renamed))
            let (stateStatus, state) = await json("GET", "/api/auth/state", as: a)
            check("GET /api/auth/state has mail, passkeys and google (\(stateStatus))", ["mail", "passkeys", "google"].allSatisfy { (state as? [String: Any])?[$0] is Bool })
            let (loginsStatus, logins) = await json("GET", "/api/auth/logins", as: a)
            check("Inloggningsmetoder: GET /api/auth/logins (\(loginsStatus))", loginsStatus == 200 && logins is [Any])
            let (mineStatus, mine) = await json("GET", "/api/my-reports", as: a)
            check("Mina felrapporter: GET /api/my-reports (\(mineStatus))", mineStatus == 200 && mine is [Any])
            let (reportsStatus, _) = await json("GET", "/api/reports", as: a)
            check("Felrapporter refused to an admin (\(reportsStatus))", reportsStatus == 403)
            let (remote, _) = await json("GET", "/api/orgs", as: a)
            check("Alla organisationer refused to an admin (\(remote))", remote == 403)

            // The organisation exported by the core's plan, its files fetched, and imported into another.
            let rows = (try? alice.core.call("exportRowsView", json: "{}", caller: nil).get()).flatMap { $0 }.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8), options: .fragmentsAllowed) as? String } ?? ""
            let planText = (try? alice.core.call("exportPlanView", ["orgName": "Församlingen", "today": "2026-11-21", "now": 1, "rows": rows, "users": users ?? []], caller: nil).get()) ?? nil
            let plan = planText.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
            let files = plan?["files"] as? [[String: Any]] ?? []
            check("the export plan names the sound and the text (\(files.count) files)", files.contains { $0["name"] as? String == "blobs/\(hash)" } && files.contains { $0["name"] as? String == "bibles/\(textHash).json" })
            var fetchedAll = true
            for f in files {
                guard let path = f["path"] as? String, let name = f["name"] as? String else { continue }
                let target = URL(filePath: dir).appending(path: name.replacingOccurrences(of: "/", with: "_"))
                if (try? await server.download(path, as: a, to: target)) != true { fetchedAll = false; continue }
                // Into the other organisation, as the import uploads them.
                let body = try Data(contentsOf: target)
                let up = try await server.put(name.hasPrefix("blobs/") ? "/api/media/\(String(name.dropFirst(6)))" : "/api/bibles/\(textHash)", data: body,
                                              contentType: name.hasPrefix("blobs/") ? "application/octet-stream" : "application/json", as: c)
                if !(200..<300).contains(up.status) { fetchedAll = false }
            }
            check("every file fetched and uploaded to the other organisation", fetchedAll)
            let entries = plan?["entries"] as? [[String: Any]] ?? []
            var tables: [String: Any] = [:]
            for e in entries { if let n = e["name"] as? String, n.hasPrefix("rows/"), let t = e["text"] as? String { tables[String(n.dropFirst(5).dropLast(5))] = try JSONSerialization.jsonObject(with: Data(t.utf8)) } }
            let usersText = entries.first { $0["name"] as? String == "users.json" }?["text"] as? String ?? "[]"
            let importText = (try? alice.core.call("importPlanView", ["format": 8, "rows": tables, "users": usersText], caller: nil).get()) ?? nil
            let importPlan = importText.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
            check("the core reads the export back (\(importPlan == nil ? "refused" : "ok"))", importPlan != nil)
            let (usersAdded, _) = await json("POST", "/api/import/users", importPlan?["users"] ?? [], as: c)
            check("POST /api/import/users (\(usersAdded))", usersAdded == 200)
            let legacy = try await server.request("POST", "/api/import/legacy", json: importPlan?["rows"] as? String ?? "{}", as: c)
            check("POST /api/import/legacy (\(legacy.status) \(legacy.error ?? ""))", (200..<300).contains(legacy.status))
            let carol = try SyncClient(path: "\(dir)/carol.sqlite", session: c)
            carol.start()
            check("the other organisation has the sound and the Bible", await wait(10) {
                (try? carol.core.db.query("SELECT 1 FROM audios WHERE id = 'A1'"))?.isEmpty == false && (try? carol.core.db.query("SELECT 1 FROM bibles WHERE id = 'bible:ps'"))?.isEmpty == false
            })
            // The video, the decks and the live status (SettingsMediaCheck.swift); the deck the test gives (GP_PPTX_DECK).
            await SettingsMediaCheck.run(alice: alice, bob: bob, dir: dir, pptx: ProcessInfo.processInfo.environment["GP_PPTX_DECK"], check: check, wait: wait)
            alice.close()
            bob.close()
            carol.close()
        } catch {
            check("run: \(error)", false)
        }
        return failures
    }
}
