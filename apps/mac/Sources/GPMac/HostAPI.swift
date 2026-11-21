// The organisation's server, for what is the server's and not the synced data's (docs/accounts-and-roles.md,
// docs/sign-in-and-pairing.md): the members and invitations, the paired devices, one's own profile and sign-ins, the
// organisations, the bug reports, the export. The same endpoints the web's pages call (apps/web/src/auth/api.ts), as
// the signed-in device; the demo has no server, and says so.
import Foundation
import Shell

/// What the server answered: the decoded body, or the code of why not (the server's `error`, `offline`, or
/// `no-server` for the demo).
enum HostResult<T> {
    case ok(T)
    case refused(String)

    var value: T? { if case let .ok(v) = self { v } else { nil } }
    var error: String? { if case let .refused(e) = self { e } else { nil } }
}

/// A body the caller does not read.
struct Nothing: Decodable {}

extension AppState {
    /// `method path` with `body` as JSON, as the signed-in device; the answer's body decoded as `T`.
    func api<T: Decodable>(_ method: String, _ path: String, _ body: Any? = nil, as: T.Type = Nothing.self) async -> HostResult<T> {
        guard let session, let server = try? Server(session.server) else { return .refused("no-server") }
        do {
            let a = try await server.request(method, path, json: body.map { Core.json($0) }, as: session)
            guard (200..<300).contains(a.status) else { return .refused(a.error ?? "status-\(a.status)") }
            if T.self == Nothing.self { return .ok(Nothing() as! T) }
            guard let v = try? JSONDecoder().decode(T.self, from: a.body) else { return .refused("unreadable") }
            return .ok(v)
        } catch {
            return .refused("offline")
        }
    }

    /// The signed-in user as the server says they are now (a new name, superadminläge, a new token): the session kept
    /// and the organisation's database opened again with it, as the web loads the page again.
    func reopen(token: String? = nil, me: Me) {
        guard let old = session else { return }
        if case let .synced(client) = store { client.close() }
        open(Session(server: old.server, token: token ?? old.token, device: old.device, me: me))
    }

    /// Into another organisation one is in (`POST /api/auth/switch`, the web's switchOrg): its database opened with the
    /// new session. The refusal's code, or nil.
    func switchOrg(_ orgId: String) async -> String? {
        struct SignedIn: Decodable { let token: String, me: Me }
        switch await api("POST", "/api/auth/switch", ["orgId": orgId], as: SignedIn.self) {
        case let .refused(e): return e
        case let .ok(s): reopen(token: s.token, me: s.me); return nil
        }
    }

    /// A file of the server's (an export) to a temporary file named `name`; nil when it did not come.
    func download(_ path: String, name: String) async -> URL? {
        guard let session, let server = try? Server(session.server) else { return nil }
        let file = FileManager.default.temporaryDirectory.appending(path: name)
        return (try? await server.download(path, as: session, to: file)) == true ? file : nil
    }
}

extension Model {
    func api<T: Decodable>(_ method: String, _ path: String, _ body: Any? = nil, as type: T.Type = Nothing.self) async -> HostResult<T> {
        await app.api(method, path, body, as: type)
    }
}

/// A refusal's words, as the web's `errorText` gives them: the server's code as `error.<code>`, else offline.
func hostRefusal(_ code: String) -> String {
    switch code {
    case "offline": return t("auth.offline")
    case "no-server": return n("noServer")
    default:
        let key = "error.\(code)"
        let said = t(key)
        return said == key ? t("error.unknown") : said
    }
}
