// A phone lying down and moving on a phone (the web's PhoneLive.tsx landscape and RunningOrder.tsx's ≡): presenting
// lying down, the picture and its buttons stand at the right of the running order (the core's `pageLayoutView`); in
// Markera's select mode a row held is moved. Run by `apps/mac/apple.sh uitest`; skipped on an iPad, which has columns.
import XCTest

final class PhoneTests: XCTestCase {
    private var sv: [String: String] = [:]

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    private func launch(_ extra: [String]) throws -> XCUIApplication {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "a phone's one column")
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/packages/rust-core/scenarios/sunday.json", "-gp.open", "p1"] + extra
            + ["-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    func testLyingDownWhilePresentingThePictureStandsAtTheRight() throws {
        let app = try launch(["-gp.show", "i1/0"])
        XCUIDevice.shared.orientation = .landscapeLeft

        let beside = app.otherElements["live-beside"].firstMatch.exists ? app.otherElements["live-beside"].firstMatch : app.scrollViews["live-beside"].firstMatch
        XCTAssertTrue(beside.waitForExistence(timeout: 10), "the picture's column")
        XCTAssertGreaterThan(beside.frame.minX, app.windows.firstMatch.frame.width / 2, "at the right")
    }

    func testUprightWhilePresentingThePictureStandsAboveTheOrder() throws {
        let app = try launch(["-gp.show", "i1/0"])

        XCTAssertTrue(app.buttons["black"].firstMatch.waitForExistence(timeout: 10), "Släck, by the picture")
        XCTAssertFalse(app.scrollViews["live-beside"].firstMatch.exists, "no column beside")
    }

    func testARowHeldInMarkeraIsMoved() throws {
        let app = try launch([])
        let more = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "Tack min Gud")].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15))
        more.tap()
        app.buttons[sv["presentation.tick"]!].firstMatch.tap()
        let last = app.buttons["tick-i2"].firstMatch, first = app.buttons["tick-h1"].firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 5))

        last.press(forDuration: 1.2, thenDragTo: first)

        XCTAssertLessThan(app.buttons["tick-i2"].firstMatch.frame.minY, app.buttons["tick-h1"].firstMatch.frame.minY, "moved to the top")
    }
}
