// Noter och länkar in the presentation's menu (the core's `presentationMaterialsView`): the songs with materials, in
// the running order, each with its own; a song without any left out. Its data is materials.json beside this file. Run
// by `apps/mac/apple.sh uitest`.
import XCTest

final class MaterialsTests: XCTestCase {
    func testNoterOchLankarListsTheSongWithItsLinkAndLeavesOutTheOther() throws {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        let sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/apps/mac/ios/UITests/materials.json", "-gp.open", "p1",
                               "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        let title = app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Söndag'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15), "the presentation's title, its menu")

        title.tap()
        let entry = app.buttons[sv["material.title"]!].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 3), "Noter och länkar in the menu")
        entry.tap()

        XCTAssertTrue(app.buttons["material-m1"].firstMatch.waitForExistence(timeout: 5), "the song's link")
        // The song without materials is left out (the core's test says so); the page behind the sheet still names it.
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'material-'")).count, 1, "the one link")
        app.buttons["materials-close"].firstMatch.tap()
        XCTAssertTrue(app.buttons["material-m1"].firstMatch.waitForNonExistence(timeout: 5))
    }
}
