// Replays the TS core's random mutations through the native Rust core and Swift's SQLite; every outcome must match.
// The final databases are written for compare-final.mjs, which compares their rows with the TS core's.
import Foundation
import Shell

let fixtures = CommandLine.arguments[1], outDir = CommandLine.arguments[2]
let lines = try String(contentsOfFile: "\(fixtures)/parity.jsonl", encoding: .utf8).split(separator: "\n")
var cores: [Int: Core] = [:]
var mismatches = 0, total = 0, sqlCalls = 0
let t = Date()
for line in lines {
    let rec = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
    let seed = rec["seed"] as! Int
    if cores[seed] == nil {
        let path = "\(outDir)/swift-\(seed).sqlite"
        try? FileManager.default.removeItem(atPath: path)
        try FileManager.default.copyItem(atPath: "\(fixtures)/seed.sqlite", toPath: path)
        let db = try Database(path: path)
        if let mode = ProcessInfo.processInfo.environment["GP_SYNC"] { db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = \(mode)") }
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
