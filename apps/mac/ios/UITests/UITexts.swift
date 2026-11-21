// What the UI tests share: the app's Swedish texts, to find a control by what it says.
import XCTest

/// The app's Swedish texts, from the table apps/mac/texts.mjs writes from the web's i18n.ts.
func swedishTexts(_ repo: String) throws -> [String: String] {
    let swift = try String(contentsOfFile: "\(repo)/apps/mac/Sources/GPMac/TextTable.swift", encoding: .utf8)
    let json = try XCTUnwrap(swift.range(of: "#\"").flatMap { start in swift.range(of: "\"#", options: .backwards).map { swift[start.upperBound..<$0.lowerBound] } })
    let table = try JSONDecoder().decode([String: [String: String]].self, from: Data(json.utf8))
    return try XCTUnwrap(table["sv"])
}
