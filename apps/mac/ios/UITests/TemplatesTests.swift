// Templates (the web's Templates.tsx, Presentations.tsx's TemplatePicker, SaveAsTemplateDialog.tsx): Skapa
// presentation from a template copies its items and prefills its name; Mallar lists the templates with their slot
// (the core's `templateView`) and makes one; Spara som mall makes one of a presentation. Data: templates.json beside
// this file. Run by `apps/mac/apple.sh uitest`.
import XCTest

final class TemplatesTests: XCTestCase {
    private var sv: [String: String] = [:]

    private func launch(_ extra: [String] = []) throws -> XCUIApplication {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/apps/mac/ios/UITests/templates.json"] + extra + ["-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()
        return app
    }

    func testAPresentationFromATemplateTakesItsNameAndItsItems() throws {
        let app = try launch()
        let plus = app.buttons[sv["presentations.new"]!].firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 15))
        plus.tap()
        let template = app.buttons["template-t1"].firstMatch
        XCTAssertTrue(template.waitForExistence(timeout: 5), "the template offered")
        XCTAssertTrue(template.label.contains("11:00"), "with its slot: \(template.label)")

        template.tap()
        XCTAssertTrue(app.textFields["Gudstjänst"].firstMatch.waitForExistence(timeout: 5), "its name prefilled")
        app.buttons["sheet-confirm"].firstMatch.tap()

        let item = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: "Härlig är jorden")].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "the template's song copied into the new presentation")
    }

    func testMallarListsTheTemplatesWithTheirSlot() throws {
        let app = try launch()
        let account = app.buttons["Demo"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 15))
        account.tap()
        app.buttons[sv["nav.templates"]!].firstMatch.tap()

        let row = app.buttons["template-t1"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(row.label.contains(sv["weekday.0"]!) && row.label.contains("Kyrkan"), "Söndag 11:00 · Kyrkan: \(row.label)")
    }

    func testSparaSomMallMakesATemplateOfThePresentation() throws {
        let app = try launch(["-gp.open", "p1"])
        let title = app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Söndag'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        title.tap()
        app.buttons[sv["templates.saveAsMenu"]!].firstMatch.tap()
        let save = app.alerts.buttons[sv["common.save"]!].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 3), "its name asked, the presentation's prefilled")
        save.tap()

        XCTAssertTrue(app.alerts[sv["templates.savedAs"]!].firstMatch.waitForExistence(timeout: 5), "said so")
    }

    func testATemplatesMenuOffersItsOwnTrashAndNoSparaSomMall() throws {
        let app = try launch(["-gp.open", "t1"])
        // A template's page: its menu offers its own trash, not Spara som mall.
        let title = app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Gudstjänst'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        title.tap()
        XCTAssertTrue(app.buttons[sv["templates.trash"]!].firstMatch.waitForExistence(timeout: 3), "Radera mall on a template")
        XCTAssertFalse(app.buttons[sv["templates.saveAsMenu"]!].firstMatch.exists, "no Spara som mall on a template")
    }
}
