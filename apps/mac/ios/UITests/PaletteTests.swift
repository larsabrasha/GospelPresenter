// ⌘K, the search of everything (the web's CommandPalette.tsx; the core's `paletteView` for the presentations):
// songs, presentations, commands and pages of Inställningar found by their words; in a presentation a song added
// where + would add it. Opened by the start page's magnifier, or by `-gp.palette` where a test cannot press ⌘K.
// Run by `apps/mac/apple.sh uitest`.
import XCTest

final class PaletteTests: XCTestCase {
    private var sv: [String: String] = [:]

    private func launch(_ extra: [String]) throws -> XCUIApplication {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fresh", "YES"] + extra + ["-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    private func type(_ text: String, in app: XCUIApplication) {
        let field = app.textFields["palette-field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the palette's field")
        field.tap()
        field.typeText(text)
    }

    func testTheMagnifierFindsAPresentationByNameAndOpensIt() throws {
        let app = try launch([])
        let open = app.buttons["palette-open"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        open.tap()
        type("Kvällssamling", in: app)

        let hit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'palette-presentation-'")).firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 5), "the presentation found")
        hit.tap()

        XCTAssertTrue(app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kvällssamling'")).firstMatch.waitForExistence(timeout: 5), "opened")
    }

    func testAPageOfInstallningarIsFoundByItsWords() throws {
        let app = try launch(["-gp.palette", "YES"])
        type("Teman", in: app)

        XCTAssertTrue(app.staticTexts[sv["palette.settings"]!].firstMatch.waitForExistence(timeout: 5), "Inställningar's pages among the hits")
    }

    func testASongIsAddedToThePresentationOpen() throws {
        let app = try launch(["-gp.open", "pres-main", "-gp.palette", "YES"])
        type("Amazing", in: app)
        let add = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'palette-add-'")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5), "the song's Lägg till")

        add.tap()

        // Added last, where + adds with nothing selected: further down the running order on a phone.
        let item = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "Amazing grace")].firstMatch
        for _ in 0..<40 where !item.exists { app.swipeUp() }
        XCTAssertTrue(item.waitForExistence(timeout: 5), "the song in the running order")
    }
}
