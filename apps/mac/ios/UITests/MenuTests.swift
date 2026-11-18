// What the app's item menus offer, checked against the core's answers for the same scenario (docs/view-models.md):
// packages/rust-core/scenarios/sunday.json made afresh in the app (`-gp.fixture`), and in each state of
// sunday.expected.json each item's menu holds the entries the core offers that this app draws, enabled as the core
// says, and none that the core does not offer. Run by `apps/mac/apple.sh uitest`, which tells it where the repository is.
import XCTest

final class MenuTests: XCTestCase {
    /// The entries the app draws (ItemMenu's `drawn`); the core's others wait for their pages.
    private static let drawn: Set<String> = ["rename", "note", "arrangement", "addAfter", "headerAbove", "delete"]

    private struct Action: Decodable { let id: String, text: String, enabled: Bool }
    private struct Group: Decodable { let id: String, actions: [Action] }
    private struct State: Decodable { let state: String, menus: [String: [Group]] }
    private struct Expected: Decodable { let items: [Item], states: [State]; struct Item: Decodable { let id: String, title: String } }

    func testEachItemMenuOffersWhatTheCoreOffersInEveryState() throws {
        let repo = try XCTUnwrap(ProcessInfo.processInfo.environment["GP_REPO"], "run by apps/mac/apple.sh uitest")
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: URL(fileURLWithPath: "\(repo)/packages/rust-core/scenarios/sunday.expected.json")))
        let sv = try Self.swedish("\(repo)/apps/mac/Sources/GPMac/TextTable.swift")
        let app = XCUIApplication()
        app.launchArguments = ["-gp.demo", "YES", "-gp.fixture", "\(repo)/packages/rust-core/scenarios/sunday.json", "-gp.open", "p1",
                               "-AppleLanguages", "(sv)", "-AppleLocale", "sv_SE"]
        app.launch()

        for state in expected.states {
            reach(state.state, in: app)
            for item in expected.items {
                let more = app.buttons[sv["live.itemMore"]!.replacingOccurrences(of: "{title}", with: item.title)]
                XCTAssertTrue(more.waitForExistence(timeout: 5), "\(state.state): no … for \(item.title)")
                more.tap()
                let offered = state.menus[item.id]!.flatMap(\.actions).filter { Self.drawn.contains($0.id) }
                for action in offered {
                    let entry = app.buttons[sv[action.text]!]
                    XCTAssertTrue(entry.waitForExistence(timeout: 2), "\(state.state), \(item.title): \(action.id) missing")
                    XCTAssertEqual(entry.isEnabled, action.enabled, "\(state.state), \(item.title): \(action.id) enabled")
                }
                // An entry the app draws but the core does not offer here must not be there.
                for id in Self.drawn.subtracting(offered.map(\.id)) {
                    for key in Self.keys[id] ?? [] where !offered.contains(where: { sv[$0.text] == sv[key] }) {
                        XCTAssertFalse(app.buttons[sv[key]!].exists, "\(state.state), \(item.title): \(id) drawn but not offered")
                    }
                }
                // Out of the menu, by a tap beside it (a menu takes that tap itself), and wait until it has gone.
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.92)).tap()
                XCTAssertTrue(app.buttons[sv["note.title"]!].waitForNonExistence(timeout: 3), "\(state.state), \(item.title): the menu stayed")
            }
        }
    }

    /// The texts each drawn entry may have, to look for one the core did not offer.
    private static let keys: [String: [String]] = [
        "rename": ["header.rename"], "note": ["note.title"], "arrangement": ["song.arrangements"],
        "addAfter": ["live.addAfter"], "headerAbove": ["header.above"], "delete": ["common.delete", "live.shownCannotRemove"],
    ]

    /// The scenario's state reached as someone would reach it; its keys in sunday.json say the same: presenting started,
    /// the song's first part (two steps from the start) shown, and then Släck.
    private func reach(_ state: String, in app: XCUIApplication) {
        switch state {
        case "shown":
            app.buttons["start"].tap()
            let part = app.staticTexts["Härlig är jorden, härlig är Guds himmel"].firstMatch
            XCTAssertTrue(part.waitForExistence(timeout: 5))
            part.tap()
        case "black":
            app.buttons["black"].tap()
        default:
            break
        }
    }

    /// The app's Swedish texts, from the table apps/mac/texts.mjs writes from the web's i18n.ts.
    private static func swedish(_ path: String) throws -> [String: String] {
        let swift = try String(contentsOfFile: path, encoding: .utf8)
        let json = try XCTUnwrap(swift.range(of: "#\"").flatMap { start in swift.range(of: "\"#", options: .backwards).map { swift[start.upperBound..<$0.lowerBound] } })
        let table = try JSONDecoder().decode([String: [String: String]].self, from: Data(json.utf8))
        return try XCTUnwrap(table["sv"])
    }
}
