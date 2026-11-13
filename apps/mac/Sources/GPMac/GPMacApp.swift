// A native macOS shell over the Rust core: the presentations, a running order with its slides, and an output window.
import AppKit
import SwiftUI

@main
struct GPMacApp: App {
    @State private var model = Model()

    init() {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some Scene {
        WindowGroup("Gospel Presenter", id: "main") {
            MainView().environment(model).frame(minWidth: 1100, minHeight: 680)
        }
        .defaultSize(width: 1500, height: 940)
        Window("Utgång", id: "output") {
            OutputView().environment(model)
        }
        .defaultSize(width: 960, height: 540)
    }
}

struct MainView: View {
    @Environment(Model.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        NavigationSplitView {
            PresentationsColumn()
        } content: {
            ItemsColumn()
        } detail: {
            SlidesColumn()
        }
        .navigationTitle(model.current?.name ?? "Presentationer")
        .navigationSubtitle(model.current.map { [$0.eventDate, $0.time].compactMap { $0 }.joined(separator: " ") } ?? "")
        .onAppear(perform: demo)
    }

    /// GP_MAC_DEMO: the first presentation of the screenshots, a slide live, the output open; GP_MAC_SNAPSHOT: pictures of the windows.
    private func demo() {
        let env = ProcessInfo.processInfo.environment
        if let out = env["GP_MAC_PERF"] { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Perf.run(model, out: out) } }
        guard env["GP_MAC_DEMO"] != nil else { return }
        model.selectedPresentation = "pres-main"
        // Presenting from Tusen skäl's second slide, the next one made ready, a comment on the item.
        model.run("setItemNote", ["itemId": "pres-main-i1", "note": "Börja med refrängen"])
        model.live(["type": "show", "itemId": "pres-main-i1", "partIndex": 1])
        model.live(["type": "start"])
        model.live(["type": "pick", "delta": 1])
        model.live(["type": "pick", "delta": 1])
        openWindow(id: "output")
        guard let out = env["GP_MAC_SNAPSHOT"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApp.windows.first { $0.title != "Utgång" && $0.isVisible }?.setContentSize(NSSize(width: 1500, height: 940))
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
