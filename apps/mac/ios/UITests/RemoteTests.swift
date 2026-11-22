// Remote control and outputs from the iOS app against a server (spec 04 §1, §2): another computer presents with remote
// control allowed; the start page shows it under Visas just nu with Ta kontroll; taken, the page drives it: a part
// tapped is sent as a command the presenting computer takes. And presenting here, Visning switches a public output on. Needs a server and that computer: run by
// apps/server/test/native-remote-ui.test.ts (GP_NATIVE_UI=1), which hands the session over in GP_SESSION.
import XCTest

final class RemoteTests: XCTestCase {
    func testTakeControlDrivesASessionPresentedElsewhere() throws {
        let session = try handedOver()
        let app = XCUIApplication()
        app.launchArguments = ["-gp.session", session, "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()

        let take = app.buttons["take-control"].firstMatch
        XCTAssertTrue(take.waitForExistence(timeout: 30), "Ta kontroll for the session elsewhere")
        take.tap()
        XCTAssertTrue(app.staticTexts["remote-banner"].firstMatch.waitForExistence(timeout: 10), "the remote control banner")
        let part = app.buttons["part-i1/1"].firstMatch
        XCTAssertTrue(part.waitForExistence(timeout: 10), "the presentation's second part")

        part.tap()

        XCTAssertTrue(part.waitForSelectionOrMark(timeout: 5), "shown at once")
    }

    /// The session native-remote-ui.test.ts hands over; without it the test is skipped (thrown outside XCTUnwrap,
    /// which would count the skip as a failure).
    fileprivate func handedOver() throws -> String {
        guard let session = ProcessInfo.processInfo.environment["GP_SESSION"] else { throw XCTSkip("run by native-remote-ui.test.ts") }
        return session
    }
}

extension RemoteTests {
    func testVisningSwitchesAPublicOutputOnWhilePresenting() throws {
        let session = try handedOver()
        let sv = try swedishTexts(XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"]))
        let app = XCUIApplication()
        app.launchArguments = ["-gp.session", session, "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        let row = app.staticTexts["Kvällsmöte"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30), "the presentation made elsewhere, synced")
        row.tap()
        app.buttons["start"].firstMatch.tap()
        let part = app.buttons["part-k1/0"].firstMatch
        XCTAssertTrue(part.waitForExistence(timeout: 10))
        part.tap()
        app.buttons[sv["live.display"]!].firstMatch.tap()
        let output = app.switches["output-d1"].firstMatch
        XCTAssertTrue(output.waitForExistence(timeout: 10), "the public output among Utgångar")

        output.switches.firstMatch.exists ? output.switches.firstMatch.tap() : output.tap()

        let on = expectation(for: NSPredicate(format: "value == '1'"), evaluatedWith: output)
        wait(for: [on], timeout: 10) // the server lists it as this session's, so it reads as sent to
    }
}

private extension XCUIElement {
    /// Marked as shown (VISAS) or picked, within `timeout`.
    func waitForSelectionOrMark(timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if isSelected || label.contains("VISAS") { return true }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return false
    }
}
