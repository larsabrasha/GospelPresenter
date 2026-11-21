// The output on iOS: an external display (a cable, or AirPlay screen mirroring used as a second screen) gets a scene of
// its own (`UIWindowSceneSessionRoleExternalDisplayNonInteractive`) showing the Mac's OutputView over the app's one
// AppState: the slide presented, full screen, black otherwise. Its output is on or off: by hand from Utgångar in the
// presentation's bar, or by itself while presenting under Slå på utgångar automatiskt (AutoOutputs.swift, the core's
// `autoOutputsView`): at the start, and when a display connects while it runs.
#if os(iOS)
import SwiftUI
import UIKit

@MainActor @Observable
final class ExternalOutput {
    static let shared = ExternalOutput()
    /// The app's state, which the external scene shows (set by GPiOSApp).
    @ObservationIgnored weak var app: AppState?

    /// A display connected: its scene's id, and the name its last switch by hand is kept under.
    struct Display: Hashable { let id: String, name: String }
    private(set) var displays: [Display] = []
    /// The displays whose output is on.
    private(set) var on: Set<String> = []
    /// The displays as the last step saw them, nil before the presentation's first.
    @ObservationIgnored private var known: [[String: String]]?

    private var listed: [[String: String]] { displays.map { ["id": $0.id, "name": $0.name] } }

    func connected(_ d: Display) {
        displays.append(d)
        follow(starting: false)
    }

    func disconnected(_ id: String) {
        displays.removeAll { $0.id == id }
        follow(starting: false)
        on.remove(id)
    }

    /// Switched by hand from Utgångar: kept for the next time it would come on by itself.
    func turn(_ d: Display, _ value: Bool) {
        if value { on.insert(d.id) } else { on.remove(d.id) }
        OutputMemory.remember(d.name, value)
    }

    /// A step: at the presentation's start (`starting`) or a change of the displays while it runs.
    func follow(starting: Bool) {
        guard let app, let model = app.anyModel, app.live.id != nil, OutputMemory.on else { known = nil; return }
        if starting { known = nil }
        let now = listed
        let before = known
        known = now
        guard let step = OutputMemory.step(model, before: before, now: now, open: Array(on)) else { return }
        on.subtract(step.off)
        on.formUnion(step.on)
    }
}

/// The external display's scene: a window over the whole display, the output in it.
final class ExternalSceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        MainActor.assumeIsolated {
            guard let app = ExternalOutput.shared.app else { return }
            let id = session.persistentIdentifier
            let window = UIWindow(windowScene: scene)
            window.rootViewController = UIHostingController(rootView: ExternalOutputRoot(id: id, model: Model(app: app)))
            window.isHidden = false
            self.window = window
            // Its name: a cable's or AirPlay's display is not named by iOS, so one name for each kind of screen.
            ExternalOutput.shared.connected(.init(id: id, name: n("externalDisplay")))
        }
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        let id = scene.session.persistentIdentifier
        MainActor.assumeIsolated { ExternalOutput.shared.disconnected(id) }
        window = nil
    }
}

/// The output while on, black while off.
struct ExternalOutputRoot: View {
    let id: String
    let model: Model

    var body: some View {
        Group {
            if ExternalOutput.shared.on.contains(id) { OutputView() } else { Color.black.ignoresSafeArea() }
        }
        .environment(model)
        .accessibilityIdentifier("externalOutput")
    }
}

/// The scene for an external display is ExternalSceneDelegate's; every other is SwiftUI's own.
final class GPAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // A configuration without a delegate is SwiftUI's own (its WindowGroup); the external display's has this one.
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        if session.role == .windowExternalDisplayNonInteractive { config.delegateClass = ExternalSceneDelegate.self }
        return config
    }
}

/// Utgångar in the presentation's bar while a display is connected: each display's output on or off by hand.
struct ExternalOutputsMenu: View {
    var body: some View {
        let output = ExternalOutput.shared
        if !output.displays.isEmpty {
            Menu {
                ForEach(output.displays, id: \.self) { d in
                    Toggle(d.name, isOn: Binding(get: { output.on.contains(d.id) }, set: { output.turn(d, $0) }))
                }
            } label: { Label(t("live.outputs"), systemImage: "tv") }
            .accessibilityIdentifier("outputs")
        }
    }
}

/// On a main window: the step at a presentation's start.
struct AutoOutputsFollow: ViewModifier {
    @Environment(Model.self) private var model

    func body(content: Content) -> some View {
        content.onChange(of: model.live.id) { before, now in
            if before == nil, now != nil { ExternalOutput.shared.follow(starting: true) }
        }
    }
}
#endif
