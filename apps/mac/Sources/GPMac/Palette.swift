// ⌘K, the search of everything (Lars, 2026-11-05; the web's CommandPalette.tsx): one field, and under it, grouped as
// Spotlight's, the songs by title or a line (`searchSongsView`), the presentations by name, place or date, the coming
// ones first (`paletteView`), the commands, and the pages of Inställningar (`settingsSearchView`). With nothing typed,
// the open page's likeliest actions, the coming presentations and the commands. In a presentation a song's Lägg till
// adds it where + would (and while presenting shows it); a song opens its page, a presentation opens, a page of
// Inställningar opens there. ⌘K anywhere, the start page's magnifier too.
import SwiftUI

private struct Found: Decodable { let presentations: [PresentationRow] }

/// The sections the web's `g` goes to (appKeys.ts SECTIONS), each a page of Inställningar here.
private let sections: [(page: String, text: String)] = [
    ("songs", "shortcuts.goSongs"), ("bibles", "shortcuts.goBibles"), ("images", "shortcuts.goImages"),
    ("audios", "shortcuts.goAudios"), ("videos", "shortcuts.goVideos"), ("customSlides", "shortcuts.goSlides"),
]

struct Palette: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var typing: Bool

    private var blank: Bool { query.trimmingCharacters(in: .whitespaces).isEmpty }
    private func matches(_ texts: String?...) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty || texts.contains { $0?.lowercased().contains(q) == true }
    }

    var body: some View {
        NavigationStack {
            List {
                TextField(t("palette.placeholder"), text: $query)
                    .focused($typing).autocorrectionDisabled()
                    .accessibilityIdentifier("palette-field")
                if blank {
                    actions
                    presentations
                    commands
                } else {
                    songs
                    presentations
                    commands
                    settings
                }
            }
            .navigationTitle(t("palette.title"))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close"), systemImage: "xmark") { dismiss() } } }
            .onAppear { typing = true }
        }
        .macWidth(560)
    }

    // MARK: The groups

    /// The open presentation's likeliest: Starta before presenting; Släck and Avsluta while presenting.
    @ViewBuilder private var actions: some View {
        if let p = model.current, !model.path.isEmpty {
            Section(t("palette.suggested")) {
                if model.isLive {
                    if !model.live.state.black { row(t("live.clear"), "moon") { model.send(["type": "black"]) } }
                    row(t("live.end"), "stop.fill") { model.endPresenting() }
                } else if model.canStart, !p.isTemplate {
                    row(t("presentation.start"), "play.fill") { model.send(["type": "start"]) }
                }
                row(t("palette.addKind", ["kind": t("add.song").lowercased()]), "plus") { model.addingSong = AddAt(after: model.afterFor(nil)) }
            }
        }
    }

    @ViewBuilder private var songs: some View {
        let hits = Array(model.searchSongs(query).prefix(5))
        if !hits.isEmpty {
            Section(t("palette.songs")) {
                ForEach(hits) { s in
                    HStack {
                        NavigationLink { SongEditorPage(id: s.id) } label: {
                            VStack(alignment: .leading) {
                                Text(s.name)
                                if let a = s.author, !a.isEmpty { Text(a).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                        if model.current != nil, !model.path.isEmpty {
                            Button(t(model.isLive ? "palette.addShow" : "palette.add")) { addSong(s) }
                                .buttonStyle(.bordered).controlSize(.small)
                                .accessibilityIdentifier("palette-add-\(s.id)")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var presentations: some View {
        let today = localToday()
        let found = model.view("paletteView", ["query": blank ? "" : query, "today": today, "locale": Texts.language], as: Found.self)?.presentations ?? []
        if !found.isEmpty {
            Section(t("palette.presentations")) {
                ForEach(found) { p in
                    row(p.name, "calendar", subtitle: written(p.line)) {
                        model.path = [p.id]
                    }
                    .accessibilityIdentifier("palette-presentation-\(p.id)")
                }
            }
        }
    }

    @ViewBuilder private var commands: some View {
        let all: [(String, String, () -> Void)] = sections.map { s in (t(s.text), "chevron.right", { open(settings: s.page) }) }
            + [(t("songs.new"), "plus", { open(settings: "songs") }), (t("shortcuts.settings"), "gearshape", { open(settings: "settings") })]
        let shown = all.filter { matches($0.0) }
        if !shown.isEmpty {
            Section(t("palette.commands")) { ForEach(shown, id: \.0) { c in row(c.0, c.1) { c.2() } } }
        }
    }

    @ViewBuilder private var settings: some View {
        let keys = model.view("settingsSearchKeysView", as: [String].self) ?? []
        let texts = Dictionary(keys.map { ($0, t($0)) }) { a, _ in a }
        let rows = Array((model.view("settingsSearchView", ["role": model.role, "host": false, "query": query, "texts": texts], as: [SettingsRow].self) ?? []).prefix(5))
        if !rows.isEmpty {
            Section(t("palette.settings")) {
                ForEach(rows, id: \.key) { r in row(t(r.text), Look.symbol(r.icon), subtitle: r.where.map { t($0) } ?? "") { open(settings: r.id) } }
            }
        }
    }

    // MARK: Doing

    private func row(_ title: String, _ icon: String, subtitle: String = "", _ run: @escaping () -> Void) -> some View {
        Button { dismiss(); run() } label: {
            HStack {
                Image(systemName: icon).frame(width: 22).foregroundStyle(.secondary)
                VStack(alignment: .leading) {
                    Text(title).foregroundStyle(.primary)
                    if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Inställningar on `page`: a Mac's window, iOS's sheet.
    private func open(settings page: String) {
        model.settingsPage = page
        #if os(iOS)
        model.settingsOpen = true
        #else
        model.openSettingsWindow = true
        #endif
    }

    /// A song added where + would add it, picked; while presenting, shown at once.
    private func addSong(_ s: SongHit) {
        guard let pid = model.selectedPresentation else { return }
        let itemId = model.newId()
        var args: [String: Any] = ["itemId": itemId, "presentationId": pid, "songId": s.id]
        if let after = model.afterFor(nil) { args["afterItemId"] = after }
        guard model.run("addSongToPresentation", args) == "ok" else { return }
        model.added(itemId)
        if model.isLive { model.send(["type": "show", "itemId": itemId, "partIndex": 0]) }
        dismiss()
    }
}
