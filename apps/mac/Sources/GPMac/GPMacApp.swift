// A native shell over the Rust core for the Mac and iOS, laid out as the web's 2.0 (docs/layout-2-0.md): the start
// page, a presentation opened from it, presenting; on the Mac an output window.
import SwiftUI
#if os(macOS)
import AppKit

@main
struct GPMacApp: App {
    @State private var app = AppState()

    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("Gospel Presenter", id: "main") {
            InWindow(app: app) { RootView().frame(minWidth: 1100, minHeight: 680).modifier(MacDemo()) }
        }
        .defaultSize(width: 1500, height: 940)
        Window(t("live.outputWindow"), id: "output") {
            InWindow(app: app) { OutputView() }
        }
        .defaultSize(width: 960, height: 540)
    }
}
#else
/// iOS: the same pages; no output yet (an external display and AirPlay come later). On an iPad each window is its own
/// (InWindow), over the app's one state.
@main
struct GPiOSApp: App {
    @State private var app = AppState()

    /// The app's colour on its windows, as an app's accent colour is set: the system then draws its own controls in it,
    /// an alert's preferred action filled with white words. SwiftUI's `.tint` coloured those words too, blue on blue.
    init() { UIWindow.appearance().tintColor = UIColor(Color.sky) }

    var body: some Scene {
        WindowGroup(id: "main") {
            InWindow(app: app) { RootView() }
        }
    }
}
#endif

/// A window's own Model over the app's state, made once for the window and kept for its life: its pages, its
/// selection and the slide made ready are its own (docs/view-models.md, "State in three places").
struct InWindow<Content: View>: View {
    @State private var model: Model
    private let content: Content

    init(app: AppState, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: Model(app: app))
        self.content = content()
    }

    var body: some View {
        content.environment(model)
            // The system's window, so another window can bring this one forward (a presentation has one window).
            .background(WindowReader { [model] window in model.window = window }.frame(width: 0, height: 0).accessibilityHidden(true))
    }
}

/// Connecting first, then the start page, and a presentation opened from it on the same stack ("‹ Presentationer"
/// back). The poke socket is closed while the app is in the background, and opened again (with a sync) when it comes
/// back, as the web's worker reconnects.
struct RootView: View {
    @Environment(Model.self) private var model
    @Environment(\.scenePhase) private var phase
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        @Bindable var model = model
        Group {
            if model.store == nil {
                ConnectView()
            } else {
                NavigationStack(path: $model.path) {
                    StartPage().navigationDestination(for: String.self) { _ in PresentationScreen() }
                }
            }
        }
        // `-gp.secondWindow YES`: a second window, once, for the UI test of two windows.
        .task { if model.app.takeSecondWindow() { openWindow(id: "main") } }
        .onChange(of: phase) { _, now in
            guard case let .synced(client)? = model.store else { return }
            if now == .background { client.close() }
            if now == .active { client.start() }
        }
    }
}

#if os(macOS)
struct MacDemo: ViewModifier {
    @Environment(Model.self) private var model
    @Environment(\.openWindow) private var openWindow

    func body(content: Content) -> some View { content.onAppear(perform: demo) }

    /// GP_MAC_DEMO: the first presentation of the screenshots, a slide live, the output open; GP_MAC_SNAPSHOT: pictures of
    /// the windows, without GP_MAC_DEMO of the start page.
    private func demo() {
        let env = ProcessInfo.processInfo.environment
        if let out = env["GP_MAC_PERF"] { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Perf.run(model, out: out) } }
        guard env["GP_MAC_DEMO"] != nil else {
            if let out = env["GP_MAC_SNAPSHOT"] { snapshot(out) }
            return
        }
        model.path = ["pres-main"]
        // Presenting from Tusen skäl's second slide, the next one made ready, a comment on the item.
        model.run("setItemNote", ["itemId": "pres-main-i1", "note": "Börja med refrängen"])
        model.send(["type": "start"])
        model.send(["type": "show", "itemId": "pres-main-i1", "partIndex": 1])
        model.send(["type": "pick", "delta": 1])
        model.send(["type": "pick", "delta": 1])
        openWindow(id: "output")
        guard let out = env["GP_MAC_SNAPSHOT"] else { return }
        snapshot(out)
    }

    /// The windows as pictures, `<out>-<n>.png`, the main one 1 500 × 940 as the web's pictures.
    private func snapshot(_ out: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApp.windows.first { $0.title != t("live.outputWindow") && $0.isVisible }?.setContentSize(NSSize(width: 1500, height: 940))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            for (n, window) in NSApp.windows.filter({ $0.isVisible && $0.contentView != nil }).enumerated() {
                guard let frame = window.contentView?.superview, let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds) else { continue }
                frame.cacheDisplay(in: frame.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: "\(out)-\(n).png"))
            }
        }
    }
}
#endif
