// The network of the native shell: HTTP and the poke socket to a sync server (the desktop host on the LAN, or the
// cloud), the device's credentials, and a host's own certificate trusted once, as a browser's warning is accepted once.
import CryptoKit
import Foundation
import Security

/// The signed-in user, as the server answers it (`Me` in packages/core/src/accounts.ts); what the shell needs of it.
public struct Me: Codable, Equatable, Sendable {
    public let userId: String, name: String, role: String, orgId: String, orgName: String
}

/// A device's sign-in at a server: the session's bearer token, the paired device's token on a desktop host, and who.
public struct Session: Codable, Equatable, Sendable {
    public let server: String
    public let token: String
    public let device: String?
    public var me: Me
}

/// What a server answered: the status and the body's bytes.
public struct Answer: Sendable {
    public let status: Int
    public let body: Data
    /// The body's `error`, as the server's refusals carry it.
    public var error: String? { (try? JSONDecoder().decode(ErrorBody.self, from: body))?.error }
    private struct ErrorBody: Decodable { let error: String? }
}

/// A host's certificate this device does not trust yet: its SHA-256, for the person to compare and accept.
public struct UntrustedCertificate: Error, Sendable {
    public let host: String, fingerprint: String
}

/// The certificates a person accepted, one per host (host → SHA-256 of the leaf certificate), kept on the device.
public enum PinnedCertificates {
    private static let key = "gp.pinnedCertificates"
    public static var all: [String: String] {
        get { UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
    public static func trust(_ c: UntrustedCertificate) { all[c.host] = c.fingerprint }
}

/// Lets a host's self-signed certificate through when the person accepted exactly that one for that host
/// (`GP_TLS=self-signed`, docs/lan-https-and-addresses.md); everything else as the system decides.
final class Trust: NSObject, URLSessionDelegate, @unchecked Sendable {
    /// The last certificate refused, by host: what `Server` reports when a request fails on it.
    private let lock = NSLock()
    private var refused: [String: String] = [:]

    func refusedFingerprint(_ host: String) -> String? { lock.withLock { refused[host] } }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = challenge.protectionSpace.serverTrust else {
            return (.performDefaultHandling, nil)
        }
        if SecTrustEvaluateWithError(trust, nil) { return (.performDefaultHandling, nil) }
        let host = challenge.protectionSpace.host
        guard let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first else { return (.cancelAuthenticationChallenge, nil) }
        let fingerprint = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02X", $0) }.joined(separator: ":")
        if PinnedCertificates.all[host] == fingerprint { return (.useCredential, URLCredential(trust: trust)) }
        lock.withLock { refused[host] = fingerprint }
        return (.cancelAuthenticationChallenge, nil)
    }
}

/// HTTP to one server. A network failure throws; any HTTP answer returns.
public final class Server: Sendable {
    public let base: URL
    let session: URLSession
    private let trust = Trust()

    public init(_ address: String) throws {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.contains("://") { text = "https://\(text)" }
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text), url.host != nil else { throw URLError(.badURL) }
        base = url
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config, delegate: trust, delegateQueue: nil)
    }

    /// The request's headers: the session's bearer token, and on a desktop host the paired device's token.
    static func headers(_ s: Session?) -> [String: String] {
        guard let s else { return [:] }
        return ["authorization": "Bearer \(s.token)"].merging(s.device.map { ["x-gp-device": $0] } ?? [:]) { a, _ in a }
    }

    public func request(_ method: String, _ path: String, json: String? = nil, as s: Session? = nil) async throws -> Answer {
        var req = URLRequest(url: base.appending(path: path))
        req.httpMethod = method
        for (k, v) in Self.headers(s) { req.setValue(v, forHTTPHeaderField: k) }
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = Data(json.utf8)
        }
        do {
            let (data, res) = try await session.data(for: req)
            return Answer(status: (res as? HTTPURLResponse)?.statusCode ?? 0, body: data)
        } catch let e as URLError where e.code == .cancelled || e.code == .serverCertificateUntrusted || e.code == .secureConnectionFailed {
            if let host = base.host(), let fingerprint = trust.refusedFingerprint(host) { throw UntrustedCertificate(host: host, fingerprint: fingerprint) }
            throw e
        }
    }

    /// The poke socket (`/api/sync/poke`): the credentials as subprotocols, so they stay out of the address and logs,
    /// as the web's `socketProtocols` sends them.
    func socket(_ path: String, clientId: String, as s: Session) -> URLSessionWebSocketTask {
        var parts = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        parts.scheme = base.scheme == "https" ? "wss" : "ws"
        parts.queryItems = [URLQueryItem(name: "clientId", value: clientId)]
        let protocols = ["gp.v1", "gp.auth.\(s.token)"] + (s.device.map { ["gp.device.\($0)"] } ?? [])
        return session.webSocketTask(with: parts.url!, protocols: protocols)
    }
}

/// The session kept in the Keychain, so a restarted app opens straight into its database (spec 01: signed in once).
public enum Keychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.gospelpresenter.native", kSecAttrAccount as String: "session"]

    public static var session: Session? {
        get {
            var q = query
            q[kSecReturnData as String] = true
            var out: AnyObject?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
            return try? JSONDecoder().decode(Session.self, from: data)
        }
        set {
            SecItemDelete(query as CFDictionary)
            guard let newValue, let data = try? JSONEncoder().encode(newValue) else { return }
            var q = query
            q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(q as CFDictionary, nil)
        }
    }
}

/// Pairing with a desktop host (docs/sign-in-and-pairing.md): `/api/pair/status`, then `/api/pair/dev` on a host that
/// lets any device in (development, `GP_DEV_PAIR=1`), else the six-digit code the host shows (`/api/pair/claim`).
public enum Pairing {
    public enum Status: Sendable { case dev, code, notAHost }
    public struct Refused: Error, Sendable { public let code: String }

    public static func status(_ server: Server) async throws -> Status {
        let a = try await server.request("GET", "/api/pair/status")
        struct Body: Decodable { let required: Bool, dev: Bool }
        guard a.status == 200, let b = try? JSONDecoder().decode(Body.self, from: a.body), b.required else { return .notAHost }
        return b.dev ? .dev : .code
    }

    /// The device's token and a session, as the member the host chose. `code` nil asks the development route.
    public static func claim(_ server: Server, code: String?, name: String) async throws -> Session {
        let body = code.map { Core.json(["code": $0, "name": name]) } ?? Core.json(["name": name])
        let a = try await server.request("POST", code == nil ? "/api/pair/dev" : "/api/pair/claim", json: body)
        struct Claimed: Decodable { let device: String; let session: SignedIn }
        struct SignedIn: Decodable { let token: String; let me: Me }
        guard a.status == 200, let c = try? JSONDecoder().decode(Claimed.self, from: a.body) else { throw Refused(code: a.error ?? "status-\(a.status)") }
        return Session(server: server.base.absoluteString, token: c.session.token, device: c.device, me: c.session.me)
    }
}
