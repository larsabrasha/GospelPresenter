// Windows on an iPad (docs/layout-2-0.md, Lars 2026-11-18): a presentation has one window, as a Keynote document has.
// Opened from another window's start page, the window that has it comes forward, with its own page state (here the
// slide made ready there), rather than a second page of it. Run by `apps/mac/apple.sh uitest "iPad Pro 13-inch
// (M5)"`; skipped on a phone, which has one window.
import XCTest

final class WindowsTests: XCTestCase {
    func testOpeningAPresentationOpenInAnotherWindowBringsThatWindowForward() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "an iPad's windows")
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        let app = XCUIApplication()
        let arguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/packages/rust-core/scenarios/sunday.json", "-gp.open", "p1",
                         "-gp.pick", "i1/0", "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        // Alone, the window opens the Sunday with the song's first slide made ready: what tells that window apart.
        app.launchArguments = arguments
        app.launch()
        let alone = app.buttons["part-i1/0"].firstMatch
        XCTAssertTrue(alone.waitForExistence(timeout: 15))
        XCTAssertTrue(alone.isSelected, "the slide made ready in the first window")
        app.terminate()
        // Again, and a second window opened at once (the system's own way to one, ⌘N or the app's windows, cannot be
        // driven here); the second comes to the front, on its start page.
        app.launchArguments = arguments + ["-gp.secondWindow", "YES"]
        app.launch()
        let row = app.staticTexts["Söndag"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the second window's start page")

        row.tap()

        let part = app.buttons["part-i1/0"].firstMatch
        XCTAssertTrue(part.waitForExistence(timeout: 10))
        XCTAssertTrue(part.isSelected, "the first window, come forward with its slide made ready, not a second page of it")
    }
}
