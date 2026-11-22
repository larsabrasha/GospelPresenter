// Redigera detaljer and Skapa presentation (the web's PresentationDetailsDialog), whose fields, Spara and ↵ are the
// core's (`detailsStepView`): a name changed and saved is the page's title; Avbryt keeps it; a blank name may not be
// saved; ↵ in a new one's name makes it and opens it. Data: templates.json beside this file. Run by `apps/mac/apple.sh
// uitest`.
import XCTest

final class DetailsTests: XCTestCase {
    private var sv: [String: String] = [:]

    private func launch(_ extra: [String] = []) throws -> XCUIApplication {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fresh", "YES", "-gp.fixture", "\(repo)/apps/mac/ios/UITests/templates.json"] + extra + ["-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    /// Söndag's page, its details opened from the title's menu, the name field.
    private func editing(_ app: XCUIApplication) -> XCUIElement {
        let title = app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Söndag'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        title.tap()
        app.buttons[sv["presentation.editDetailsMenu"]!].firstMatch.tap()
        let name = app.textFields["Söndag"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5), "the name as it is")
        return name
    }

    /// The field's text typed over: every character deleted, then `text`.
    private func retype(_ field: XCUIElement, _ text: String) {
        field.tap()
        let old = (field.value as? String) ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 2) + text)
    }

    func testANameSavedIsThePagesTitle() throws {
        let app = try launch(["-gp.open", "p1"])
        retype(editing(app), "Advent")

        app.buttons["sheet-confirm"].firstMatch.tap()

        XCTAssertTrue(app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Advent'")).firstMatch.waitForExistence(timeout: 5))
    }

    func testAvbrytKeepsTheName() throws {
        let app = try launch(["-gp.open", "p1"])
        retype(editing(app), "Advent")

        app.buttons["sheet-cancel"].firstMatch.tap()

        XCTAssertTrue(app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Söndag'")).firstMatch.waitForExistence(timeout: 5))
    }

    func testABlankNameMayNotBeSaved() throws {
        let app = try launch(["-gp.open", "p1"])
        retype(editing(app), " ")

        XCTAssertFalse(app.buttons["sheet-confirm"].firstMatch.isEnabled)
    }

    func testReturnInANewOnesNameMakesItAndOpensIt() throws {
        let app = try launch()
        let plus = app.buttons[sv["presentations.new"]!].firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 15))
        plus.tap()
        app.buttons["template-blank"].firstMatch.tap()
        let name = app.textFields[sv["presentations.defaultName"]!].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5), "the app's word for a new one")
        retype(name, "Kvällsmöte\n")

        XCTAssertTrue(app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kvällsmöte'")).firstMatch.waitForExistence(timeout: 5), "made and opened")
    }
}
