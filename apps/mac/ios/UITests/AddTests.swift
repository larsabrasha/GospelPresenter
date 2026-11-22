// Lägg till's kinds (the web's AddItemDialog.tsx): a Bible text searched and browsed (the core's `verseSearchPlanView`,
// `bibleBrowseView`, `bibleSlidesView`), and a library's pictures and sounds picked and added (`addPickView`). The
// Bible's data is adding.json beside this file (a sample of a public-domain translation); the libraries the demo's.
// Run by `apps/mac/apple.sh uitest`.
import XCTest

final class AddTests: XCTestCase {
    private var sv: [String: String] = [:]

    private func launch(_ arguments: [String]) throws -> XCUIApplication {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = arguments.map { $0.replacingOccurrences(of: "$REPO", with: repo) } + ["-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    /// Lägg till's kind `key` chosen from +.
    private func add(_ key: String, in app: XCUIApplication) {
        let plus = app.buttons[sv["live.add"]!].firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 15), "Lägg till")
        plus.tap()
        let kind = app.buttons[sv[key]!].firstMatch
        XCTAssertTrue(kind.waitForExistence(timeout: 3), "\(key) among the kinds")
        kind.tap()
    }

    /// The sheet's add button, whatever it names.
    private func confirm(_ app: XCUIApplication) {
        let button = app.buttons["sheet-confirm"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 3) && button.isEnabled, "the sheet's Lägg till")
        button.tap()
    }

    /// An item in the running order whose title holds `text`, by its … .
    private func item(_ text: String, in app: XCUIApplication) -> XCUIElement {
        let more = sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "")
        return app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", more, text)).firstMatch
    }

    func testABibleReferenceSearchedIsAddedAsAnItem() throws {
        let app = try launch(["-gp.demo", "YES", "-gp.fixture", "$REPO/apps/mac/ios/UITests/adding.json", "-gp.open", "p1"])
        add("add.bible", in: app)
        let search = app.textFields["bible-search"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Joh 3:16")

        XCTAssertTrue(app.staticTexts["bible-title"].firstMatch.waitForExistence(timeout: 5), "the passage's preview")
        confirm(app)
        app.buttons["sheet-cancel"].firstMatch.tap()

        XCTAssertTrue(item("3:16", in: app).waitForExistence(timeout: 5), "the reading in the running order")
    }

    func testABiblePassageBrowsedPicksFromTheStartVerseToTheEnd() throws {
        let app = try launch(["-gp.demo", "YES", "-gp.fixture", "$REPO/apps/mac/ios/UITests/adding.json", "-gp.open", "p1"])
        add("add.bible", in: app)
        for cell in ["bible-JHN", "bible-3", "bible-16", "bible-18"] {
            let button = app.buttons[cell].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 5), cell)
            button.tap()
        }

        let title = app.staticTexts["bible-title"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue(title.label.contains("16") && title.label.contains("18"), "the passage 3:16–18: \(title.label)")
    }

    func testAPicturePickedIsAddedUnderItsName() throws {
        // The demo's library has one picture; several become one item named by their number (the core's test).
        let app = try launch(["-gp.demo", "YES", "-gp.fresh", "YES", "-gp.open", "pres-main"])
        add("add.image", in: app)
        let pick = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pick-'")).firstMatch
        XCTAssertTrue(pick.waitForExistence(timeout: 5), "the library's pictures")

        pick.tap()
        XCTAssertTrue(pick.isSelected, "picked")
        confirm(app)

        // Added, the sheet stays open with nothing picked (D15); the running order behind it shows only what is in view.
        XCTAssertFalse(pick.isSelected, "added, and let go")
    }

    func testASoundPickedIsAddedAsAnItem() throws {
        let app = try launch(["-gp.demo", "YES", "-gp.fresh", "YES", "-gp.open", "pres-main"])
        add("presentation.audioTab", in: app)
        let pick = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pick-'")).firstMatch
        XCTAssertTrue(pick.waitForExistence(timeout: 5), "the library's sounds")

        pick.tap()
        XCTAssertTrue(pick.isSelected, "picked")
        confirm(app)

        // Added, the sheet stays open with nothing picked (D15); the running order behind it shows only what is in view.
        XCTAssertFalse(pick.isSelected, "added, and let go")
    }
}
