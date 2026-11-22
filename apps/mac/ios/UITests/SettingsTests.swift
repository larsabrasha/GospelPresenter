// Inställningar as someone uses them, where the code reviews found bugs that no build shows (AGENTS.md, "The native
// apps"): a field saved only when changed, Sånger's letter index, Shift+Enter in Etiketter, a question before a song
// goes to the trash, its days left in the trash, and Slå på utgångar automatiskt kept. Over UITests/settings.json made afresh at each launch; run
// by `apps/mac/apple.sh uitest`, on a phone (the settings pushed page by page).
import XCTest

final class SettingsTests: XCTestCase {
    private var app: XCUIApplication!
    private var sv: [String: String] = [:]

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom == .pad, "a phone's settings")
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        sv = try swedishTexts(repo)
        app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/apps/mac/ios/UITests/settings.json", "-gp.open", "p1",
                               "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
    }

    private func open(_ page: String) {
        app.launchArguments += ["-gp.settings", page]
        app.launch()
    }

    /// ‹ of the settings, the last bar's: the presentation's own bar lies under the sheet.
    private func back() { app.navigationBars.buttons.matching(identifier: "BackButton").allElementsBoundByIndex.last?.tap() }

    /// A song's row in Sånger, reached by its letter in the index: a list draws only the rows in sight.
    private func song(_ name: String) -> XCUIElement {
        let l = letter(String(name.prefix(1)))
        XCTAssertTrue(l.waitForExistence(timeout: 5))
        l.tap()
        let row = app.buttons[name].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        return row
    }

    func testOpeningASongAndLeavingItsFieldsKeepsItsItemsOwnTitle() {
        open("songs")
        song("Härlig är jorden").tap()
        let name = app.textFields[sv["song.name"]!]
        XCTAssertTrue(name.waitForExistence(timeout: 5))

        // Into the name and out of it to the next field, unchanged, then back: as the web, nothing is saved.
        name.tap()
        app.textFields[sv["song.author"]!].tap()
        back()
        back()
        app.buttons[sv["common.close"]!].firstMatch.tap()

        XCTAssertTrue(app.staticTexts["Inledningssång"].firstMatch.waitForExistence(timeout: 5), "the item's own title, reset by an unchanged save")
    }

    func testAChangedSongNameIsSavedWhenLeft() {
        open("songs")
        song("Härlig är jorden").tap()
        let name = app.textFields[sv["song.name"]!]
        XCTAssertTrue(name.waitForExistence(timeout: 5))

        // At the text's end: the field is right-aligned, so its right edge.
        name.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        name.typeText(" igen")
        app.textFields[sv["song.author"]!].tap()
        back()

        XCTAssertTrue(app.staticTexts["Härlig är jorden igen"].waitForExistence(timeout: 5))
    }

    func testATapOnTheLetterIndexJumpsToItsLetter() {
        open("songs")
        let zion = app.staticTexts["Zion sång"]
        XCTAssertTrue(app.staticTexts["Alla sång"].waitForExistence(timeout: 5))
        XCTAssertFalse(zion.isHittable, "the list's end, out of sight at first")

        letter("Z").tap()

        XCTAssertTrue(zion.waitForHittable(timeout: 3))
    }

    func testAFingerDraggedDownTheLetterIndexJumpsToTheLetterUnderIt() {
        open("songs")
        XCTAssertTrue(app.staticTexts["Alla sång"].waitForExistence(timeout: 5))
        let from = letter("A").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let to = letter("Z").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))

        from.press(forDuration: 0.1, thenDragTo: to)

        XCTAssertTrue(app.staticTexts["Zion sång"].waitForHittable(timeout: 3))
    }

    func testShiftReturnInANewLabelCreatesItAndEmptiesTheFieldForTheNext() throws {
        // The simulator's typeKey taps the on-screen keys: "a" came out "A" and Shift+Return did nothing, on a phone and
        // an iPad alike (tried 2026-11-21), so a key command cannot be reached from here.
        try XCTSkipIf(true, "XCUITest sends no modifiers on iOS; try Shift+Return with a keyboard on a device")
        open("labels")
        app.buttons[sv["common.create"]!].firstMatch.tap()
        let field = app.textFields[sv["labels.field"]!]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Kör")

        field.typeKey(.return, modifierFlags: .shift)

        XCTAssertTrue(app.staticTexts[sv["labels.created"]!].waitForExistence(timeout: 3))
        XCTAssertNotEqual(field.value as? String, "Kör", "the field emptied for the next")
    }

    func testPuttingASongInTheTrashAsksFirst() {
        open("songs")
        let row = song("Härlig är jorden")
        row.swipeLeft()
        app.buttons[sv["images.remove"]!].firstMatch.tap()

        // iOS 26 asks in a popover with the one choice, and a tap outside it is Avbryt.
        let question = app.sheets.firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 3), "a question, not the song gone at once")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()

        XCTAssertTrue(question.waitForNonExistence(timeout: 3))
        XCTAssertTrue(row.exists, "the song still there")
    }

    func testASongPutInTheTrashShowsTheDaysItHasLeftInTheCoresWords() {
        open("songs")
        song("Härlig är jorden").swipeLeft()
        app.buttons[sv["images.remove"]!].firstMatch.tap()
        let question = app.sheets.firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 3))
        app.buttons[sv["song.trash"]!].firstMatch.tap()

        back()
        // Papperskorg near the list's foot: scrolled to, a list drawing only the rows in sight.
        let trash = app.staticTexts[sv["nav.trash"]!].firstMatch
        for _ in 0..<4 where !trash.isHittable { app.swipeUp() }
        trash.tap()

        let left = sv["trash.days"]!.replacingOccurrences(of: "{n}", with: "30")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", left)).firstMatch.waitForExistence(timeout: 3), "\(left) on the song's row")
    }

    func testTurningOutputsOnAutomaticallyOffIsKeptAfterARestart() {
        open("settings")
        let toggle = autoOutputs()
        if toggle.value as? String == "0" { toggle.switches.firstMatch.tap() }

        toggle.switches.firstMatch.tap()
        app.terminate()
        app.launch()

        let again = autoOutputs()
        XCTAssertEqual(again.value as? String, "0")
        again.switches.firstMatch.tap()    // on again, as it was
    }

    func testCommandZWhileTypingANameUndoesTheTypingNotTheThemesChange() {
        let name = newTheme()
        let undo = app.buttons[sv["slideEditor.undo"]!].firstMatch
        // The main text picked on the stage, its size changed (a step for Ångra), and back to the theme's own fields.
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 200, dy: 273)).tap()
        let size = app.sliders.firstMatch
        XCTAssertTrue(size.waitForExistence(timeout: 3))
        size.adjust(toNormalizedSliderPosition: 0.2)
        XCTAssertTrue(undo.isEnabled, "Ångra has the change")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Bakgrund")).firstMatch.tap()
        XCTAssertTrue(name.waitForExistence(timeout: 3))
        name.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        name.typeText("xyz")

        name.typeKey("z", modifierFlags: .command)

        XCTAssertEqual(name.value as? String, sv["themes.new"], "the typing undone in the field")
        XCTAssertTrue(undo.isEnabled, "the theme's change not undone")
    }

    func testAChangedThemeNameIsSavedWhenGoingBackFromIt() {
        let name = newTheme()
        name.typeText(" ett")

        back()

        XCTAssertTrue(app.staticTexts["\(sv["themes.new"]!) ett"].waitForExistence(timeout: 5))
    }

    // Focus moved to another field cannot be tried here: every page whose name is saved when left and that works
    // without a server (a theme, a Bible, a custom slide, an arrangement) has that one field.
    func testAChangedThemeNameIsSavedByTheKeyboardsReturn() {
        let name = newTheme()
        name.typeText(" två")

        app.keyboards.buttons["Return"].tap()

        // Out of the field already, so ‹ saves nothing itself (only a field still being typed in saves on closing).
        back()
        XCTAssertTrue(app.staticTexts["\(sv["themes.new"]!) två"].waitForExistence(timeout: 5))
    }

    /// Nytt tema made in Teman and its editor open, the name field typed into at its end.
    private func newTheme() -> XCUIElement {
        open("themes")
        let add = app.buttons[sv["themes.new"]!].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        let name = app.textFields[sv["song.name"]!].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        return name
    }

    /// Slå på utgångar automatiskt: a phone opens Inställningar at its list, so Mina inställningar first, then down to
    /// the row (a form draws only the rows in sight).
    private func autoOutputs() -> XCUIElement {
        let mine = app.descendants(matching: .any)[sv["nav.settings"]!].firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 5))
        mine.tap()
        let toggle = app.switches[sv["settings.autoOutputs"]!].firstMatch
        for _ in 0..<6 where !toggle.exists { app.swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 3))
        return toggle
    }

    /// A letter of Sånger's index, by its accessibility label inside the index.
    private func letter(_ l: String) -> XCUIElement {
        app.otherElements[sv["songs.index"]!].descendants(matching: .any)[l].firstMatch
    }
}

private extension XCUIElement {
    func waitForHittable(timeout: TimeInterval) -> Bool {
        let done = Date().addingTimeInterval(timeout)
        while Date() < done {
            if exists && isHittable { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))    // polls hittability, which no expectation waits for
        }
        return false
    }
}
