// The Mac's output window, and "Lägg till sång". Slides themselves are painted from the core (SlidePainter.swift)
// or drawn by the web's SlideView (SlideRenderer.swift).
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// The output window on the Mac: the slide shown, filling it, drawn as every output draws it.
struct OutputView: View {
    @Environment(Model.self) private var model

    var body: some View {
        ZStack {
            Color.black
            LiveSlide(tile: TileRequest(slide: model.live.slide?.raw, theme: model.live.theme, overlay: model.live.overlay, label: false, media: model.app.mediaGeneration),
                      video: model.live.slide == nil ? nil : model.app.player.video(for: model.live.state.itemId))
        }
        .ignoresSafeArea()
        .focusable().focusEffectDisabled()
        // The output's keys step what is shown and black it, as the page's do (`Model.send`).
        .onKeyPress(keys: [.rightArrow, .space, .return]) { _ in key(["type": "step", "delta": 1]) }
        .onKeyPress(.leftArrow) { key(["type": "step", "delta": -1]) }
        .onKeyPress("b") { key(["type": "black"]) }
        #if os(macOS)
        .onDisappear { AutoOutputs.shared.closed() }
        #endif
    }

    /// A key, to the window that has the presentation presented open (a presentation has one window), else to this
    /// window's own page of it, opened here.
    private func key(_ event: [String: Any]) -> KeyPress.Result {
        guard let id = model.live.id else { return .ignored }
        if let window = model.app.window(showing: id, except: model) { window.send(event); return .handled }
        if model.path.last != id { model.path = [id] }
        model.send(event)
        return .handled
    }
}

#if os(macOS)
/// The output on a display of its own, filling it, when there is one besides the main one; else a window.
enum OutputPlacement {
    /// On `screen`, else the first display besides the main one.
    static func place(on chosen: NSScreen? = nil) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            guard let window = NSApp.windows.first(where: { $0.title == t("live.outputWindow") }) else { return }
            guard let screen = chosen ?? NSScreen.screens.first(where: { $0 != NSScreen.main }) else { return }
            window.styleMask = [.borderless]
            window.level = .mainMenu + 1
            window.setFrame(screen.frame, display: true)
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.orderFrontRegardless()
        }
    }

    static func release() {
        NSApp.windows.first(where: { $0.title == t("live.outputWindow") && $0.styleMask.contains(.borderless) })?.close()
    }
}
#endif

