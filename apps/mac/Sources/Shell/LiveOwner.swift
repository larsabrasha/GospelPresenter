// This device as the owner of its live session (ADR 0004; the web's live/owner.ts): whatever it presents is reported
// to the server whole, on connect, on every reconnect and on every change (LIVE-R47): the presentation, the device's
// name, "Tillåt fjärrstyrning", the pointer, the outputs chosen and taken over, and what they show (the core's
// `liveSlideView` and `shownOnOutputsView`). A controller's command is taken if it still makes sense (the core's
// `liveTargetsView` and `remoteTakeView`, LIVE-R49) and handed to the shell to apply as its own change. In the shell so
// apps/mac's `parity live` drives the same code against a server.
import Foundation
import Observation

@MainActor
@Observable
public final class LiveOwner {
    public let link: LiveStatus
    @ObservationIgnored private let client: SyncClient
    @ObservationIgnored private let session: Session
    /// This window's session, for as long as the app runs.
    public let sessionId = UUID().uuidString.lowercased()
    public var deviceName: String
    /// "Tillåt fjärrstyrning" (LIVE-R39).
    public var remote = false { didSet { report() } }
    /// The outputs this session sends to (saved screens, public outputs, temporary screens).
    public private(set) var chosen: [String] = []
    /// Outputs taken from another presentation ("Ta över"), until the server says they are this one's.
    public private(set) var takeOver: [String] = []
    /// The pointer as the app's live state has it (JSON's values: presentationId, itemId, partIndex, black, overlayId, rev).
    public private(set) var pointer: [String: Any]?
    /// A controller's command taken: the shell applies it as a change of its own (`liveChangeView`).
    @ObservationIgnored public var onCommand: (([String: Any]) -> Void)?
    /// What the app's player plays, for controllers to mirror (`LiveAudio`, `LiveVideoState`); none by default.
    @ObservationIgnored public var audio: () -> Any = { NSNull() }
    @ObservationIgnored public var video: () -> Any = { NSNull() }

    /// `link`: the app's live socket, shared with what it controls elsewhere (LiveController).
    public init(client: SyncClient, session: Session, deviceName: String, link: LiveStatus? = nil) {
        (self.client, self.session, self.deviceName, self.link) = (client, session, deviceName, link ?? LiveStatus())
        self.link.onOpen = { [weak self] in self?.report() }
        self.link.onMessage = { [weak self] m in self?.heard(m) }
    }

    /// The live state changed: reported; the socket opened while presenting, closed once it ends.
    public func follow(_ pointer: [String: Any]?) {
        let presenting = (pointer?["presentationId"] as? String) != nil
        if presenting, !link.connected { link.start(session) }
        if !presenting, let was = self.pointer?["presentationId"] as? String, !was.isEmpty {
            link.send(["type": "end", "sessionId": sessionId])
            chosen = []
            takeOver = []
        }
        self.pointer = presenting ? pointer : nil
        report()
    }

    /// An output switched; taking one from another presentation (asked first by the shell) with `take`.
    public func setOutput(_ id: String, on: Bool, take: Bool = false) {
        if on { if !chosen.contains(id) { chosen.append(id) } } else { chosen.removeAll { $0 == id } }
        if on && take { if !takeOver.contains(id) { takeOver.append(id) } } else { takeOver.removeAll { $0 == id } }
        report()
    }

    /// The whole state to the server, the outputs' slide and canvas only while one is chosen.
    public func report() {
        guard let p = pointer, let pid = p["presentationId"] as? String else { return }
        let outputs = !chosen.isEmpty
        let ask: [String: Any] = ["presentationId": pid, "itemId": outputs ? (p["itemId"] ?? NSNull()) : NSNull(),
                                  "partIndex": p["partIndex"] ?? 0, "overlayId": outputs ? (p["overlayId"] ?? NSNull()) : NSNull()]
        guard let shown = client.view("liveSlideView", ask, as: AnyJSON.self)?.value else { return }
        var slide: Any = NSNull(), canvas: Any = NSNull()
        if outputs, let out = client.view("shownOnOutputsView", ["pointer": p, "shown": shown, "video": NSNull(), "now": Int(Date().timeIntervalSince1970 * 1000)], as: AnyJSON.self)?.value as? [String: Any] {
            (slide, canvas) = (out["slide"] ?? NSNull(), out["canvas"] ?? NSNull())
        }
        let pointer: [String: Any] = ["itemId": p["itemId"] ?? NSNull(), "partIndex": p["partIndex"] ?? 0, "black": p["black"] ?? false,
                                      "overlayId": p["overlayId"] ?? NSNull(), "rev": p["rev"] ?? 0]
        let state: [String: Any] = [
            "sessionId": sessionId, "presentationId": pid, "presentationName": (shown as? [String: Any])?["name"] as? String ?? "",
            "deviceName": deviceName, "remote": remote, "pointer": pointer, "outputs": chosen, "takeOver": takeOver,
            "slide": slide, "canvas": canvas, "audio": audio(), "video": video(),
        ]
        link.send(["type": "own", "state": state])
    }

    private func heard(_ m: [String: Any]) {
        switch m["type"] as? String {
        case "command":
            guard m["sessionId"] as? String == sessionId, let change = m["change"] as? [String: Any], let p = pointer, let pid = p["presentationId"] as? String else { return }
            struct There: Decodable { let item: Bool, overlay: Bool }
            struct Take: Decodable { let take: Bool }
            let there = client.view("liveTargetsView", ["presentationId": pid, "itemId": change["itemId"] ?? NSNull(), "overlayId": change["overlayId"] ?? NSNull()], as: There.self)
            let take = client.view("remoteTakeView", ["pointer": p, "command": change, "item": there?.item ?? false, "overlay": there?.overlay ?? false], as: Take.self)
            if take?.take == true { onCommand?(change) }
        case "released":
            guard m["sessionId"] as? String == sessionId, let gone = m["outputs"] as? [String] else { return }
            chosen.removeAll { gone.contains($0) }
            report()
        default: break
        }
        // Once the server lists this session on an output taken over, it is no longer asked to take it.
        if !takeOver.isEmpty, let me = link.sessions.compactMap({ $0 as? [String: Any] }).first(where: { $0["id"] as? String == sessionId }) {
            let mine = Set((me["outputs"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String })
            takeOver.removeAll { mine.contains($0) }
        }
    }
}

/// Any JSON a view answers, as JSONSerialization's values.
public struct AnyJSON: Decodable {
    public let value: Any
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull() }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let n = try? c.decode(Double.self) { value = n == n.rounded() && abs(n) < 1e15 ? Int(n) as Any : n }
        else if let s = try? c.decode(String.self) { value = s }
        else if let a = try? c.decode([AnyJSON].self) { value = a.map(\.value) }
        else { value = try c.decode([String: AnyJSON].self).mapValues(\.value) }
    }
}
