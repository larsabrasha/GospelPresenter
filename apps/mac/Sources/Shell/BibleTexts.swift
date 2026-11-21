// Bible texts on this device (docs/bibles-and-themes.md, "Bibles"), as the web's syncBibleTexts and keepBible
// (packages/sync/src/client/bibles.ts): which texts to fetch and drop, and whether one fetched is what its hash names,
// are the core's (`bibleTextPlanView`, `bibleTextStoreView`, crates/gp-core/src/bible_texts.rs); this fetches them
// from the server and writes what the core says. A device keeps the texts of the translations chosen
// ("Tillgänglig offline", `kept_bibles`); only the `bibles` row syncs.
import Foundation

extension SyncClient {
    /// A Bible text of the organisation's by its hash (`GET /api/bibles/{hash}`): its JSON, or nil when the server
    /// has none or cannot be reached.
    public func bibleText(_ hash: String) async -> String? {
        guard let answer = try? await server.request("GET", "/api/bibles/\(hash)", as: session), answer.status == 200 else { return nil }
        return String(decoding: answer.body, as: UTF8.self)
    }

    /// The texts no kept translation names dropped (never one a queued import names), then those a kept one names
    /// fetched, each kept only when the core reads it as what its hash names: the hashes kept now, and those missing.
    @discardableResult
    public func syncBibleTexts() async -> (downloaded: [String], missing: [String]) {
        struct Plan: Decodable { let fetch: [String], drop: [String] }
        guard let plan = view("bibleTextPlanView", ["keeping": "chosen"], as: Plan.self) else { return ([], []) }
        let drops = plan.drop.flatMap { h in
            ["bible_texts", "bible_blobs"].map { ("DELETE FROM \($0) WHERE hash = ?", [SqlValue.text(value: h)]) }
        }
        var changed = !drops.isEmpty && (try? write(drops)) != nil
        var result: (downloaded: [String], missing: [String]) = ([], [])
        for hash in plan.fetch {
            guard let json = await bibleText(hash), storeBibleText(hash, json: json) else {
                result.missing.append(hash)
                continue
            }
            result.downloaded.append(hash)
            changed = true
        }
        if changed { onChange?(["bible_texts", "bible_blobs"]) }
        return result
    }

    /// Keeps a translation's text on this device and fetches it now, or stops keeping it and drops it, as the web's
    /// keepBible and dropBible: kept only when the text came; whether it is kept.
    public func keepBible(_ id: String, _ on: Bool) async -> Bool {
        let kept: (String, [SqlValue]) = on
            ? ("INSERT INTO kept_bibles (id, kept_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING", [.text(value: id), .integer(value: Int64(Date().timeIntervalSince1970 * 1000))])
            : ("DELETE FROM kept_bibles WHERE id = ?", [.text(value: id)])
        try? write([kept])
        await syncBibleTexts()
        guard on else { return false }
        let stored = (try? core.db.query("SELECT 1 FROM bibles b JOIN bible_blobs t ON t.hash = b.content_hash WHERE b.id = ?", [.text(value: id)])) ?? []
        if stored.isEmpty { try? write([("DELETE FROM kept_bibles WHERE id = ?", [.text(value: id)])]) }
        onChange?(["kept_bibles"])
        return !stored.isEmpty
    }

    /// Keeps a text, fetched or imported here, as the core reads it (`bibleTextStoreView`): whether it was what `hash`
    /// names, and so kept. An `importBible` naming it can then be queued; keep its translation too (`kept_bibles`, as
    /// the web's import does), or `syncBibleTexts` drops the text once the import is pushed.
    public func storeBibleText(_ hash: String, json: String) -> Bool {
        guard case let .success(answer?) = core.call("bibleTextStoreView", ["hash": hash, "json": json], caller: caller),
              let store = Self.object(answer)["store"] as? [[String: Any]] else { return false }
        return (try? write(store.map { ($0["sql"] as? String ?? "", ($0["params"] as? [Any] ?? []).map(Self.sqlValue)) })) != nil
    }

    /// Statements on this device's own tables, in one transaction.
    func write(_ statements: [(String, [SqlValue])]) throws {
        try core.transaction { for (sql, params) in statements { _ = try core.db.query(sql, params) } }
    }

    /// A JSON value as SQLite takes it: a whole number as an integer.
    nonisolated static func sqlValue(_ v: Any) -> SqlValue {
        switch v {
        case let s as String: .text(value: s)
        case let n as NSNumber where CFNumberIsFloatType(n): .real(value: n.doubleValue)
        case let n as NSNumber: .integer(value: n.int64Value)
        default: .null
        }
    }
}
