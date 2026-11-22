// Replays the TS core's random mutations through the native Rust core and Swift's SQLite; every outcome must match.
// The final databases are written for compare-final.mjs, which compares their rows with the TS core's.
import Foundation
import Shell

// `parity sync <sessions.json> <dir>`: the native sync against a running server (SyncCheck.swift).
if CommandLine.arguments.count > 3, CommandLine.arguments[1] == "sync" {
    Task { @MainActor in exit(await SyncCheck.run(CommandLine.arguments[2], CommandLine.arguments[3])) }
    dispatchMain()
}

// `parity live <sessions.json> <dir>`: the native app as a live session's owner against a running server (LiveCheck.swift).
if CommandLine.arguments.count > 3, CommandLine.arguments[1] == "live" {
    Task { @MainActor in exit(await LiveCheck.run(CommandLine.arguments[2], CommandLine.arguments[3])) }
    dispatchMain()
}

// `parity present <sessions.json> <dir> <seconds>`: another computer presenting, for a UI test (PresentCheck.swift).
if CommandLine.arguments.count > 4, CommandLine.arguments[1] == "present" {
    Task { @MainActor in exit(await PresentCheck.run(CommandLine.arguments[2], CommandLine.arguments[3], Double(CommandLine.arguments[4]) ?? 60)) }
    dispatchMain()
}

// `parity settings <sessions.json> <dir>`: the native Inställningar against a running server (SettingsCheck.swift).
if CommandLine.arguments.count > 3, CommandLine.arguments[1] == "settings" {
    Task { @MainActor in exit(await SettingsCheck.run(CommandLine.arguments[2], CommandLine.arguments[3])) }
    dispatchMain()
}
// `parity settings-tls <sessions.json> <dir> <fingerprint>`: Videor's preview from a self-signed host (SettingsTlsCheck.swift).
if CommandLine.arguments.count > 4, CommandLine.arguments[1] == "settings-tls" {
    Task { @MainActor in exit(await SettingsTlsCheck.run(CommandLine.arguments[2], CommandLine.arguments[3], CommandLine.arguments[4])) }
    dispatchMain()
}

MainActor.assumeIsolated {
    let fixtures = CommandLine.arguments[1], outDir = CommandLine.arguments[2]
    let lines = try! String(contentsOfFile: "\(fixtures)/parity.jsonl", encoding: .utf8).split(separator: "\n")
    var cores: [Int: Core] = [:]
    var mismatches = 0, total = 0, sqlCalls = 0
    let t = Date()
    for line in lines {
        let rec = try! JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
        let seed = rec["seed"] as! Int
        if cores[seed] == nil {
            let path = "\(outDir)/swift-\(seed).sqlite"
            try? FileManager.default.removeItem(atPath: path)
            try! FileManager.default.copyItem(atPath: "\(fixtures)/seed.sqlite", toPath: path)
            let db = try! Database(path: path)
            if let mode = ProcessInfo.processInfo.environment["GP_SYNC"] { try! db.exec("PRAGMA journal_mode = WAL"); try! db.exec("PRAGMA synchronous = \(mode)") }
            cores[seed] = Core(db: db)
        }
        let got = cores[seed]!.mutate(rec["input"] as! [String: Any])
        sqlCalls += cores[seed]!.lastSqlCalls
        total += 1
        if got != rec["outcome"] as! String {
            mismatches += 1
            if mismatches <= 5 { print("DIFF: TS \(rec["outcome"]!), native \(got): \(line.prefix(200))") }
        }
    }
    let ms = Date().timeIntervalSince(t) * 1000
    print("native Rust + Swift SQLite: \(total) mutations, \(mismatches) different outcomes, \(sqlCalls) SQL calls, \(Int(ms)) ms (\(Int(ms * 1000 / Double(total))) µs each)")
    cores.removeAll()
}
