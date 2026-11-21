// Lägg till sång, as the web's song tab (apps/web/src/pages/presentation-editor/SongTab.tsx): the library searched by
// title, author or a line of the text as the core searches it (`searchSongsView`), each hit with its author and the
// words that matched marked (`highlightView`); beside the list the song chosen, its arrangements (Original first) and
// its slides as the outputs will show them in that arrangement (`songPageView`, `itemSlidesView`); and Lägg till
// "the song", which adds it after `at` and leaves the sheet open for the next (D15). Not here yet, so left out:
// Importera (.pro files), Skapa (a new song) and the pencil to the song's page, which this app does not have yet.
import SwiftUI

struct AddSongSheet: View {
    @Environment(Model.self) private var model
    let at: AddAt
    @State private var query = ""
    @State private var hits: [SongHit] = []
    @State private var chosen: String?
    @State private var arrangement: String?
    /// The item the last addition made, which the next follows (`addPositionView` with the last added).
    @State private var added: String?

    private var song: SongHit? { hits.first { $0.id == chosen } }

    var body: some View {
        HStack(spacing: 0) {
            list.frame(width: 360)
            Divider()
            SongPreview(songId: chosen, query: query, arrangement: $arrangement, theme: model.current?.theme)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .searchable(text: $query, placement: .automatic, prompt: t("presentation.searchSongs"))
        .sheetBar(t("presentation.addKind", ["kind": t("add.song").lowercased()]), cancel: t("common.close"),
                  confirm: song.map { t("presentation.addSong", ["name": $0.name]) } ?? t("presentation.add"), disabled: song == nil, add)
        .frame(minWidth: 900, minHeight: 600)
        .onAppear { search("") }
        .onChange(of: query) { _, q in search(q) }
        .onChange(of: chosen) { _, _ in arrangement = nil }
    }

    private var list: some View {
        List(hits, selection: $chosen) { hit in
            VStack(alignment: .leading, spacing: 2) {
                Marked(text: hit.name, query: query).foregroundStyle(.primary)
                if let author = hit.author, !author.isEmpty { Marked(text: author, query: query).font(.subheadline).foregroundStyle(Color.quiet) }
            }
            .padding(.vertical, 4)
            .tag(hit.id)
        }
        .overlay { if hits.isEmpty { ContentUnavailableView(t("songs.noHits"), systemImage: "music.note") } }
    }

    /// The hits for `q`; the first chosen, as the web's search keeps its best match chosen.
    private func search(_ q: String) {
        hits = model.searchSongs(q)
        if !hits.contains(where: { $0.id == chosen }) { chosen = hits.first?.id }
    }

    /// Adds the song in its arrangement and keeps the sheet open (D15): the next addition follows this one.
    private func add() -> Bool {
        guard let song, let pid = model.selectedPresentation else { return false }
        let itemId = model.newId()
        var args: [String: Any] = ["itemId": itemId, "presentationId": pid, "songId": song.id]
        if let arrangement { args["arrangementId"] = arrangement }
        if let after = added ?? at.after { args["afterItemId"] = after }
        guard model.run("addSongToPresentation", args) == "ok" else { return false }
        model.added(itemId)
        added = itemId
        return false
    }
}

/// A song's name or author with the words the query matched in bold, as the core marks them (`highlightView`).
private struct Marked: View {
    @Environment(Model.self) private var model
    let text: String, query: String

    private struct Piece: Decodable { let text: String, hit: Bool }

    var body: some View {
        let pieces = query.isEmpty ? [Piece(text: text, hit: false)] : model.view("highlightView", ["text": text, "query": query], as: [Piece].self) ?? [Piece(text: text, hit: false)]
        pieces.reduce(Text("")) { $0 + Text($1.text).fontWeight($1.hit ? .semibold : .regular) }.lineLimit(1)
    }
}

/// The song chosen: its name and author, its arrangements to choose (Original first), and its slides in that
/// arrangement as the outputs will show them.
private struct SongPreview: View {
    @Environment(Model.self) private var model
    let songId: String?
    let query: String
    @Binding var arrangement: String?
    let theme: JSONValue?

    private struct Page: Decodable {
        struct Song: Decodable { let id: String, name: String, author: String? }
        struct Arrangement: Decodable { let id: String, name: String? }
        let song: Song?
        let arrangements: [Arrangement]
    }

    private struct ItemSlides: Decodable { let slides: [Slide] }

    var body: some View {
        if let songId, let page = model.view("songPageView", ["id": songId], as: Page.self), let song = page.song {
            let chosen = arrangement ?? page.arrangements.first?.id
            let item: [String: Any] = ["id": "preview", "type": "song", "title": "", "sourceId": song.id, "arrangementId": chosen ?? NSNull(), "content": NSNull()]
            let slides = model.view("itemSlidesView", ["items": [item]], as: [String: ItemSlides].self)?["preview"]?.slides ?? []
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Marked(text: song.name, query: query).font(.headline)
                        if let author = song.author, !author.isEmpty { Marked(text: author, query: query).foregroundStyle(Color.quiet) }
                    }
                    if !page.arrangements.isEmpty { pills(page.arrangements, chosen: chosen) }
                    LazyVStack(spacing: 12) {
                        ForEach(slides) { SlideThumbnail(slide: $0, theme: theme).clipShape(RoundedRectangle(cornerRadius: 10)) }
                    }
                }
                .padding(20)
            }
        } else {
            ContentUnavailableView(t("presentation.noSongSelected"), systemImage: "music.note")
        }
    }

    /// Original first, then the song's own arrangements, the chosen one filled, as the web's ArrangementPills.
    private func pills(_ arrangements: [Page.Arrangement], chosen: String?) -> some View {
        let all = [("original", t("song.original"))] + arrangements.enumerated().map { n, a in (a.id, a.name ?? "\(t("song.arrangement")) \(n + 1)") }
        return HStack(spacing: 6) {
            ForEach(all, id: \.0) { id, title in
                Button(title) { arrangement = id }
                    .role(id == chosen ? "add" : "quiet").controlSize(.small)
            }
        }
    }
}
