// Slå på utgångar automatiskt (the web's live/autoOutputs.ts and useAutoOutputs.ts): while a presentation runs, the
// output comes on by itself on a display besides the device's own at the start and when one is connected, unless that
// display's output was last switched off by hand; a display gone has its output closed. What to switch is the core's
// (`autoOutputsView`); this device's choice (`gp.autoOutputs`, on at first, as the web's) and each display's last
// switch by hand (`gp.outputsLast`, by its name) are kept here. On a Mac the output window, full screen on the display
// (it has one, so the first display named); on iOS the external display's scene (ExternalOutput.swift).
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The device's choice and each display's last switch by hand, and a step of the core's rule over them.
@MainActor
enum OutputMemory {
    static let key = "gp.autoOutputs"
    private static let lastKey = "gp.outputsLast"

    /// This device's choice, on until switched off.
    static var on: Bool { UserDefaults.standard.object(forKey: key) == nil || UserDefaults.standard.bool(forKey: key) }

    static var last: [String: Bool] { UserDefaults.standard.dictionary(forKey: lastKey) as? [String: Bool] ?? [:] }

    /// A display's output switched by hand: the next time it comes on by itself only if it was left on.
    static func remember(_ name: String, _ on: Bool) {
        var l = last
        l[name] = on
        UserDefaults.standard.set(l, forKey: lastKey)
    }

    struct Step: Decodable { let on: [String], off: [String] }

    /// What to switch on and off as the displays went from `before` (nil at the start) to `now`, `open` those on.
    static func step(_ model: Model, before: [[String: String]]?, now: [[String: String]], open: [String]) -> Step? {
        var args: [String: Any] = ["now": now, "last": last, "open": open]
        if let before { args["before"] = before }
        return model.view("autoOutputsView", args, as: Step.self)
    }
}

#if os(macOS)
@MainActor
final class AutoOutputs {
    static let shared = AutoOutputs()

    /// The displays as the last step saw them, nil before the presentation's first.
    private var known: [[String: String]]?
    /// The display the output was put on by this, and whether this is closing it (not the user).
    private var placed: (id: String, name: String)?
    private var closing = false

    /// The displays an output may go to: every one but the operator's (the menu bar's, not the focused window's).
    private var displays: [[String: String]] {
        NSScreen.screens.filter { $0 != OutputPlacement.operatorScreen }.map { ["id": Self.id(of: $0), "name": $0.localizedName] }
    }

    private static func id(of screen: NSScreen) -> String {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { "\($0)" } ?? screen.localizedName
    }

    /// A step: at the presentation's start (`starting`) or a change of the displays while it runs.
    func follow(_ model: Model, starting: Bool, open: () -> Void) {
        guard model.live.id != nil, OutputMemory.on else { known = nil; return }
        if starting { known = nil }
        let now = displays
        let before = known
        known = now
        guard let step = OutputMemory.step(model, before: before, now: now, open: placed.map { [$0.id] } ?? []) else { return }
        if let gone = placed, step.off.contains(gone.id) {
            closing = true
            OutputPlacement.release()
            placed = nil
            closing = false
        }
        guard placed == nil, let id = step.on.first, let d = now.first(where: { $0["id"] == id }),
              let screen = NSScreen.screens.first(where: { Self.id(of: $0) == id }) else { return }
        placed = (id, d["name"] ?? "")
        open()
        OutputPlacement.place(on: screen)
    }

    /// The output window opened by hand (Fönster → Utgång) while presenting: put on the first display besides the
    /// operator's and remembered on there, as the web's hand switch is; closing it is the switch off.
    func opened() {
        guard placed == nil, !closing, OutputMemory.on, let screen = NSScreen.screens.first(where: { $0 != OutputPlacement.operatorScreen }) else { return }
        placed = (Self.id(of: screen), screen.localizedName)
        // Not for the demo's pictures (GP_MAC_DEMO), which would write into this Mac's own choice.
        if ProcessInfo.processInfo.environment["GP_MAC_DEMO"] == nil { OutputMemory.remember(screen.localizedName, true) }
        OutputPlacement.place(on: screen)
    }

    /// The output window closed: by the user while its display is still there, it stays off there next time.
    func closed() {
        guard let p = placed, !closing else { return }
        placed = nil
        if displays.contains(where: { $0["id"] == p.id }) { OutputMemory.remember(p.name, false) }
    }
}

/// On the main window: the steps at a presentation's start and at each change of the displays.
struct AutoOutputsFollow: ViewModifier {
    @Environment(Model.self) private var model
    @Environment(\.openWindow) private var openWindow

    func body(content: Content) -> some View {
        content
            .onChange(of: model.live.id) { before, now in
                if before == nil, now != nil { AutoOutputs.shared.follow(model, starting: true) { openWindow(id: "output") } }
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)) { _ in
                AutoOutputs.shared.follow(model, starting: false) { openWindow(id: "output") }
            }
    }
}
#endif
