// The Mac's output window, and "Lägg till sång". Slides themselves are the web's SlideView (SlideRenderer.swift).
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
            LiveWebView(tile: TileRequest(slide: model.live.slide?.raw, theme: model.live.theme, overlay: model.live.overlay, label: false))
        }
        .ignoresSafeArea()
        .focusable().focusEffectDisabled()
        // The output's keys step what is shown and black it, as the page's do (`Model.send`).
        .onKeyPress(keys: [.rightArrow, .space, .return]) { _ in key(["type": "step", "delta": 1]) }
        .onKeyPress(.leftArrow) { key(["type": "step", "delta": -1]) }
        .onKeyPress("b") { key(["type": "black"]) }
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
    static func place() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            guard let window = NSApp.windows.first(where: { $0.title == t("live.outputWindow") }) else { return }
            guard let screen = NSScreen.screens.first(where: { $0 != NSScreen.main }) else { return }
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

/// Lägg till sång: the library searched as the core searches it, a song chosen with a tap, added after `at`.
struct AddSongSheet: View {
    @Environment(Model.self) private var model
    let at: AddAt
    @State private var query = ""
    @State private var hits: [SongHit] = []
    @State private var chosen: String?

    var body: some View {
        List(hits) { hit in
            Button { chosen = hit.id } label: {
                HStack {
                    Text(hit.name).foregroundStyle(.primary)
                    Spacer()
                    if chosen == hit.id { Image(systemName: "checkmark").foregroundStyle(Color.sky) }
                }
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .searchable(text: $query, placement: .automatic, prompt: t("presentation.searchSongs"))
        .sheetBar(t("presentation.addKind", ["kind": t("add.song").lowercased()]), confirm: t("presentation.add"), disabled: chosen == nil, add)
        .frame(minHeight: 360)
        .macWidth(440)
        .onAppear { hits = model.searchSongs("") }
        .onChange(of: query) { _, q in hits = model.searchSongs(q); chosen = hits.first?.id }
    }

    private func add() -> Bool {
        guard let songId = chosen, let pid = model.selectedPresentation else { return false }
        let itemId = model.newId()
        var args: [String: Any] = ["itemId": itemId, "presentationId": pid, "songId": songId]
        if let after = at.after { args["afterItemId"] = after }
        guard model.run("addSongToPresentation", args) == "ok" else { return false }
        model.added(itemId)
        return true
    }
}
