// A native shell over the Rust core for the Mac and iOS, laid out as the web's 2.0 (docs/layout-2-0.md): the start
// page, a presentation opened from it, presenting; on the Mac an output window.
import SwiftUI
#if os(macOS)
import AppKit

@main
struct GPMacApp: App {
    @State private var model = Model()

    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("Gospel Presenter", id: "main") {
            RootView().environment(model).frame(minWidth: 1100, minHeight: 680).modifier(MacDemo())
        }
        .defaultSize(width: 1500, height: 940)
        Window(t("live.outputWindow"), id: "output") {
            OutputView().environment(model)
        }
        .defaultSize(width: 960, height: 540)
    }
}
#else
/// iOS: the same pages; no output yet (an external display and AirPlay come later).
@main
struct GPiOSApp: App {
    @State private var model = Model()

    var body: some Scene {
        WindowGroup {
            RootView().environment(model).tint(.sky)
        }
    }
}
#endif

/// Connecting first, then the start page, and a presentation opened from it on the same stack ("‹ Presentationer"
/// back). The poke socket is closed while the app is in the background, and opened again (with a sync) when it comes
/// back, as the web's worker reconnects.
struct RootView: View {
    @Environment(Model.self) private var model
    @Environment(\.scenePhase) private var phase

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

    /// GP_MAC_DEMO: the first presentation of the screenshots, a slide live, the output open; GP_MAC_SNAPSHOT: pictures of the windows.
    private func demo() {
        let env = ProcessInfo.processInfo.environment
        if let out = env["GP_MAC_PERF"] { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Perf.run(model, out: out) } }
        guard env["GP_MAC_DEMO"] != nil else { return }
        model.path = ["pres-main"]
        // Presenting from Tusen skäl's second slide, the next one made ready, a comment on the item.
        model.run("setItemNote", ["itemId": "pres-main-i1", "note": "Börja med refrängen"])
        model.live.press(model, ["type": "start"])
        model.live.press(model, ["type": "show", "itemId": "pres-main-i1", "partIndex": 1])
        model.live.press(model, ["type": "pick", "delta": 1])
        model.live.press(model, ["type": "pick", "delta": 1])
        openWindow(id: "output")
        guard let out = env["GP_MAC_SNAPSHOT"] else { return }
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
