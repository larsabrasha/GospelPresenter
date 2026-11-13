// The native shell: SQLite for the Rust core, which asks for every query it needs (a Crux-style effect).
import GPCoreFFI
import Foundation
import SQLite3

/// The clock the core reads when a mutation has no `now`.
@_cdecl("now_ms") public func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

public struct SQLError: Error, CustomStringConvertible { public let description: String }

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public final class Database {
    let db: OpaquePointer

    public init(path: String) throws {
        var p: OpaquePointer?
        guard sqlite3_open(path, &p) == SQLITE_OK, let p else { throw SQLError(description: "cannot open \(path)") }
        db = p
    }
    deinit { sqlite3_close(db) }

    public func exec(_ sql: String) { sqlite3_exec(db, sql, nil, nil, nil) }

    /// Rows as arrays of Int64, Double, String or NSNull.
    public func query(_ sql: String, _ params: [Any] = []) throws -> [[Any]] {
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK, let st else { throw SQLError(description: String(cString: sqlite3_errmsg(db))) }
        defer { sqlite3_finalize(st) }
        for (i, v) in params.enumerated() {
            let at = Int32(i + 1)
            switch v {
            case let s as String: sqlite3_bind_text(st, at, s, -1, SQLITE_TRANSIENT)
            case let n as NSNumber where CFNumberIsFloatType(n): sqlite3_bind_double(st, at, n.doubleValue)
            case let n as NSNumber: sqlite3_bind_int64(st, at, n.int64Value)
            default: sqlite3_bind_null(st, at)
            }
        }
        var rows: [[Any]] = []
        while true {
            let rc = sqlite3_step(st)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw SQLError(description: String(cString: sqlite3_errmsg(db))) }
            rows.append((0..<sqlite3_column_count(st)).map { c -> Any in
                switch sqlite3_column_type(st, c) {
                case SQLITE_INTEGER: return sqlite3_column_int64(st, c)
                case SQLITE_FLOAT: return sqlite3_column_double(st, c)
                case SQLITE_TEXT: return String(cString: sqlite3_column_text(st, c))
                default: return NSNull()
                }
            })
        }
        return rows
    }
}

/// The Rust core, run on a database: every mutation is one transaction.
public final class Core {
    public let db: Database
    /// The SQL calls of the last mutation, and its time in microseconds.
    public private(set) var lastSqlCalls = 0
    public private(set) var lastMicros = 0.0

    public init(db: Database) { self.db = db }

    private func send(_ data: Data, _ f: (UnsafeMutablePointer<UInt8>, Int) -> UInt32) -> UInt32 {
        let p = gp_alloc(data.count)!
        data.copyBytes(to: p, count: data.count)
        return f(p, data.count)
    }

    private func out() -> String {
        String(decoding: UnsafeBufferPointer(start: gp_out_ptr(), count: gp_out_len()), as: UTF8.self)
    }

    /// Runs one call of the core to its end; its status (0 done, 1 refused) and what it said.
    private func call(_ input: [String: Any]) -> (UInt32, String) {
        let t = Date()
        lastSqlCalls = 0
        var st = send(try! JSONSerialization.data(withJSONObject: input, options: [.fragmentsAllowed])) { gp_start($0, $1) }
        while st == 2 {
            let req = try! JSONSerialization.jsonObject(with: Data(out().utf8)) as! [String: Any]
            lastSqlCalls += 1
            let rows = (try? db.query(req["sql"] as! String, req["params"] as! [Any])) ?? []
            st = send(try! JSONSerialization.data(withJSONObject: rows)) { gp_resume($0, $1) }
        }
        lastMicros = Date().timeIntervalSince(t) * 1_000_000
        return (st, out())
    }

    /// "ok", or the refusal's code (forbidden, not-found, invalid-args, limit). One transaction.
    public func mutate(_ input: [String: Any]) -> String {
        db.exec("BEGIN")
        let (st, said) = call(input)
        db.exec(st == 0 ? "COMMIT" : "ROLLBACK")
        return st == 0 ? "ok" : said
    }

    /// A view's JSON, decoded; nil when the core refuses.
    public func view<T: Decodable>(_ name: String, _ args: [String: Any] = [:], as: T.Type) -> T? {
        let (st, said) = call(["name": name, "args": args, "ctx": ["userId": "mac", "role": "user"]])
        guard st == 0 else { return nil }
        return try? JSONDecoder().decode(T.self, from: Data(said.utf8))
    }

    public func mutate(_ name: String, _ args: [String: Any], role: String) -> String {
        mutate(["name": name, "args": args, "ctx": ["userId": "mac", "role": role]])
    }
}
