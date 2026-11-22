// A song's fields, saved as they are typed by the core's rules (`autoSaveStepView`, the web's AutoSaveField): a name
// changed is written once the field is left, a blank one is not and shows the stored name again, and a year that is
// not one is not written. The song's page reached by Redigera of its item. Run by `apps/mac/apple.sh uitest`.
import XCTest

final class SongFieldsTests: XCTestCase {
    private var sv: [String: String] = [:]

    /// Tusen skäl's page, from Redigera of its item in the demo's Sunday; its name field.
    private func songPage() throws -> (XCUIApplication, XCUIElement) {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fresh", "YES", "-gp.open", "pres-main", "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        let more = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "Tusen skäl")].firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 15))
        more.tap()
        app.buttons[sv["presentation.editSong"]!].firstMatch.tap()
        let name = app.textFields[sv["song.name"]!].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5), "the song's name")
        XCTAssertEqual(name.value as? String, "Tusen skäl")
        return (app, name)
    }

    /// The field's text typed over and the field left (↵).
    private func retype(_ field: XCUIElement, _ text: String) {
        // At its right end, where the text ends (a form's row puts it at the right): the deletes then take it all.
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        let old = (field.value as? String) ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 2) + text + "\n")
    }

    func testANameChangedIsWrittenOnceTheFieldIsLeft() throws {
        let (app, name) = try songPage()

        retype(name, "Tio tusen skäl")

        XCTAssertTrue(app.navigationBars["Tio tusen skäl"].firstMatch.waitForExistence(timeout: 5) || app.staticTexts["Tio tusen skäl"].firstMatch.waitForExistence(timeout: 2), "the page's title is the new name")
    }

    func testABlankNameIsNotWrittenAndTheStoredOneShowsAgain() throws {
        let (_, name) = try songPage()

        retype(name, " ")

        let back = NSPredicate(format: "value == 'Tusen skäl'")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: back, object: name)], timeout: 5), .completed, "the stored name again: \(name.value ?? "")")
    }

    func testAYearThatIsNotOneIsNotWritten() throws {
        let (app, _) = try songPage()
        let year = app.textFields[sv["song.year"]!].firstMatch
        XCTAssertTrue(year.waitForExistence(timeout: 5))

        retype(year, "19x8")

        XCTAssertEqual((year.value as? String).map { $0 == "19x8" }, false, "the stored year shown again: \(year.value ?? "")")
    }
}
