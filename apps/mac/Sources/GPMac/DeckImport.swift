// A PDF or a PowerPoint deck as a slideshow's pages (the web's media/slides.ts and deckImport.ts): the work is the
// shell's (`SyncClient.deckPages`, Shell/MediaImports.swift: PDFKit, or the desktop host's `POST /api/slides/pptx`),
// which apps/mac's `parity settings` runs against a server; here only the words of a refusal.
import Shell
import SwiftUI

enum DeckImport {
    /// The words of a refusal, as the web's `refusedText`.
    static func text(_ problem: String) -> String {
        t(["powerpoint": "slides.powerPoint", "oldPowerpoint": "slides.oldPowerPoint", "type": "slides.onlyPdf", "size": "slides.tooLarge",
           "name": "slides.nameTooLong", "pages": "slides.tooManyPages"][problem] ?? "slides.failed")
    }

    /// The file's pages as a slideshow keeps them, and whether a slide has a chart, or the refusal's problem.
    @MainActor static func pages(_ url: URL, model: Model) async -> Result<(pages: Any, charts: Bool), DeckRefusal> {
        guard case let .synced(client) = model.store else { return .failure(DeckRefusal("powerpoint")) }
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        switch await client.deckPages(url) {
        case let .success(r): return .success(r)
        case let .failure(r): return .failure(DeckRefusal(r.problem))
        }
    }
}

/// Why a deck was not imported, by the web's problem names.
struct DeckRefusal: Error { let problem: String; init(_ p: String) { problem = p } }
