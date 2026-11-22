// Redigera in an item's menu (the core's `itemActionsView` `opens`): a song's page, a custom slideshow's editor, an
// image item's pictures, in a sheet over the presentation, closed back to it. Run by `apps/mac/apple.sh uitest`.
import XCTest

final class EditTests: XCTestCase {
    private var sv: [String: String] = [:]

    private func launch(_ presentation: String) throws -> XCUIApplication {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.open", presentation, "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    /// The entry `key` chosen in the menu of the item titled `title`.
    private func choose(_ key: String, on title: String, in app: XCUIApplication) {
        let more = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: title)].firstMatch
        _ = more.waitForExistence(timeout: 15)
        // Further down the running order on a phone: scrolled to.
        for _ in 0..<8 where !more.isHittable { app.swipeUp() }
        XCTAssertTrue(more.isHittable, "the … of \(title)")
        more.tap()
        let entry = app.buttons[sv[key]!].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 3), "\(key) in the menu of \(title)")
        entry.tap()
    }

    func testRedigeraOfASongOpensItsPageAndClosesBackToThePresentation() throws {
        let app = try launch("pres-main")

        choose("presentation.editSong", on: "Tusen skäl", in: app)

        let name = app.textFields["Tusen skäl"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5) || app.staticTexts[sv["song.name"]!].firstMatch.exists, "the song's page")
        app.buttons["edit-close"].firstMatch.tap()
        XCTAssertTrue(app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "Tusen skäl")].firstMatch.waitForExistence(timeout: 5), "back on the presentation")
    }

    func testRedigeraOfACustomSlideshowOpensItsEditor() throws {
        let app = try launch("pres-0")

        choose("presentation.editSong", on: "Kollekt", in: app)

        XCTAssertTrue(app.buttons["edit-close"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Kollekt"].firstMatch.waitForExistence(timeout: 5) || app.textFields["Kollekt"].firstMatch.exists, "the slideshow's editor")
    }

    func testRedigeraBilderListsTheItemsPicturesAndRemovesOneAfterAQuestion() throws {
        let app = try launch("pres-main")
        choose("presentation.editImages", on: "swish.jpg", in: app)
        let pictures = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'image-'"))
        let first = pictures["image-0"].firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5), "the item's first picture")

        // iOS's edit mode: the row's red − (left of the picture), its Radera, then the question.
        first.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5)).withOffset(CGVector(dx: -40, dy: 0)).tap()
        let rowDelete = app.buttons[sv["common.delete"]!].firstMatch
        XCTAssertTrue(rowDelete.waitForExistence(timeout: 3), "the row's Radera")
        rowDelete.tap()
        XCTAssertTrue(app.staticTexts[sv["presentation.removeImageConfirm"]!].waitForExistence(timeout: 3), "asked first")
        app.buttons.matching(identifier: sv["common.delete"]!).allElementsBoundByIndex.last { $0.isHittable }?.tap()

        // The demo's item shows one of its two pictures (the other's file is gone): that one is the one removed.
        XCTAssertTrue(first.waitForNonExistence(timeout: 5), "the picture shown removed")
    }
}
