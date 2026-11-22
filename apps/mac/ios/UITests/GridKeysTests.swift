// ↑ and ↓ in a presentation's grid of slides go to the slide above and below as the tiles stand, as the web's
// (slideGridNav.ts, the core's `slideAcrossView`), not to the one before and after as ← and → do. Run by
// `apps/mac/apple.sh uitest "iPad Pro 13-inch (M5)"`; skipped on a phone, whose one column has no grid. The keys are
// pressed by `-gp.keys`, through the grid's own key handler: XCUITest's typeKey reaches only the on-screen keyboard
// on iOS, and the grid has no text field.
import XCTest

final class GridKeysTests: XCTestCase {
    /// The demo's service with its first song's first slide made ready and `keys` pressed on the grid: a song of more
    /// slides than a row holds, so the one under is not the one after.
    private func launch(keys: String) throws -> XCUIApplication {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "an iPad's grid")
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.open", "pres-main", "-gp.pick", "pres-main-i1/0", "-gp.keys", keys, "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        XCTAssertTrue(app.buttons["part-pres-main-i1/0"].firstMatch.waitForExistence(timeout: 15))
        sleep(3) // the keys are pressed a second after the grid stands
        return app
    }

    /// The slide made ready: the one tile marked as picked.
    private func picked(_ app: XCUIApplication) -> XCUIElement? {
        let tiles = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'part-' AND isSelected == true"))
        return tiles.count == 1 ? tiles.element(boundBy: 0) : nil
    }

    func testTheDownArrowGoesToTheSlideUnderTheOneMadeReady() throws {
        let app = try launch(keys: "down")

        let below = try XCTUnwrap(picked(app), "one slide made ready")
        let start = app.buttons["part-pres-main-i1/0"].firstMatch.frame
        XCTAssertGreaterThan(below.frame.minY, start.maxY, "on a row under it")
        XCTAssertEqual(below.frame.midX, start.midX, accuracy: start.width / 2, "under it, not beside it")
    }

    func testTheUpArrowGoesBackToTheSlideOverIt() throws {
        let app = try launch(keys: "down,up")

        XCTAssertEqual(picked(app)?.identifier, "part-pres-main-i1/0")
    }

    func testTheRightArrowStillGoesToTheNextSlide() throws {
        let app = try launch(keys: "right")

        XCTAssertEqual(picked(app)?.identifier, "part-pres-main-i1/1")
    }
}
