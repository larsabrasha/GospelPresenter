// Markera (the web's RunningOrder.tsx select mode; the core's `tickView`): an item's menu begins it with that item
// ticked, more are ticked, and the ticked are removed together after a question; the item shown cannot be ticked.
// On a phone in a sheet, in columns in the running order itself. Run by `apps/mac/apple.sh uitest`.
import XCTest

final class TickTests: XCTestCase {
    private var sv: [String: String] = [:]

    private func launch() throws -> XCUIApplication {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/packages/rust-core/scenarios/sunday.json", "-gp.open", "p1",
                               "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    /// Markera chosen in the menu of the item titled `title`.
    private func markera(_ title: String, in app: XCUIApplication) {
        let more = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: title)].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15), "the … of \(title)")
        more.tap()
        let entry = app.buttons[sv["presentation.tick"]!].firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 3), "Markera in the menu")
        entry.tap()
    }

    private func row(_ id: String, _ app: XCUIApplication) -> XCUIElement { app.buttons["tick-\(id)"].firstMatch }

    func testMarkeraTicksTheItemItWasChosenOn() throws {
        let app = try launch()

        markera("Tack min Gud", in: app)

        XCTAssertTrue(row("i0", app).waitForExistence(timeout: 5))
        XCTAssertTrue(row("i0", app).isSelected, "the item Markera was chosen on, ticked")
        XCTAssertFalse(row("i1", app).isSelected)
    }

    func testTheTickedItemsAreRemovedTogetherAfterAQuestion() throws {
        let app = try launch()
        markera("Tack min Gud", in: app)
        XCTAssertTrue(row("i1", app).waitForExistence(timeout: 5))
        row("i1", app).tap()

        app.buttons["tick-remove"].firstMatch.tap()
        let confirm = app.buttons[sv["common.delete"]!].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "asked first")
        confirm.tap()

        let more = { (title: String) in app.buttons[self.sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: title)].firstMatch }
        XCTAssertTrue(more("Gammal sång").waitForExistence(timeout: 5), "select mode ended, the rest of the order kept")
        XCTAssertFalse(more("Tack min Gud").exists, "the first ticked removed")
        XCTAssertFalse(more("Härlig är jorden").exists, "the second ticked removed")
    }

    func testKlarEndsSelectModeWithoutRemovingAnything() throws {
        let app = try launch()
        markera("Tack min Gud", in: app)
        XCTAssertTrue(app.buttons["tick-done"].firstMatch.waitForExistence(timeout: 5))

        app.buttons["tick-done"].firstMatch.tap()

        XCTAssertTrue(row("i0", app).waitForNonExistence(timeout: 5), "select mode ended")
        XCTAssertTrue(app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "Tack min Gud")].firstMatch.exists)
    }

    func testMarkeraAllaLeavesTheItemShownUnticked() throws {
        let app = try launch()
        app.buttons["start"].tap()
        let part = app.buttons["part-i1/0"].firstMatch
        XCTAssertTrue(part.waitForExistence(timeout: 5))
        part.tap()
        markera("Tack min Gud", in: app)
        XCTAssertTrue(app.buttons["tick-all"].firstMatch.waitForExistence(timeout: 5))

        app.buttons["tick-all"].firstMatch.tap()

        XCTAssertTrue(row("i0", app).isSelected)
        XCTAssertTrue(row("i2", app).isSelected)
        XCTAssertFalse(row("i1", app).isSelected, "the item shown cannot be ticked")
        XCTAssertFalse(row("i1", app).isEnabled)
    }
}
