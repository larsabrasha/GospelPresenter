// The app's texts: the web's (apps/web/src/i18n.ts, through apps/mac/texts.mjs's TextTable.swift), in the device's
// language when it is Swedish or English, else Swedish, as the web's default. Keys as the web's: `t("presentations.today")`.
import Foundation

enum Texts {
    /// "sv" or "en": the one chosen under Mina inställningar › Språk (`gp.language`, this device's, as the web keeps
    /// its own), else the device's.
    static var language: String = {
        if let chosen = UserDefaults.standard.string(forKey: "gp.language"), ["sv", "en"].contains(chosen) { return chosen }
        let preferred = Locale.preferredLanguages.first?.lowercased() ?? "sv"
        return preferred.hasPrefix("en") ? "en" : "sv"
    }()

    /// Språk chosen: kept for the next start, and the texts read in it from now on (the caller draws its views again).
    static func choose(_ language: String) {
        UserDefaults.standard.set(language, forKey: "gp.language")
        self.language = language
    }

    /// The locale for dates in the app's language.
    static var locale: Locale { Locale(identifier: language == "sv" ? "sv_SE" : "en_GB") }

    private static let table: [String: [String: String]] =
        (try? JSONDecoder().decode([String: [String: String]].self, from: Data(textTable.utf8))) ?? [:]

    /// The text for `key`, its `{name}` placeholders filled from `vars`; the key itself when there is none.
    static func t(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
        var text = table[language]?[key] ?? table["sv"]?[key] ?? key
        for (name, value) in vars { text = text.replacingOccurrences(of: "{\(name)}", with: value.description) }
        return text
    }
}

/// `Texts.t`, short, as the web's `t`.
func t(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String { Texts.t(key, vars) }

/// The few texts only the native app has (the web has no address to type, no certificate to accept, no demo): kept
/// here rather than in i18n.ts, whose every key the web's own code must use (packages/architecture).
func n(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
    let table: [String: (sv: String, en: String)] = [
        "demo": ("Visa demodata", "Show the demo data"),
        "addressHint": ("Adressen visas på värden: https och port 47843, eller http och port 47800.", "The host shows its address: https and port 47843, or http and port 47800."),
        "notAHost": ("Det svarar inte som kyrkans dator. Inloggning mot molnet finns inte i appen än.", "That is not a church's host computer. Signing in to the cloud is not in the app yet."),
        "refused": ("Värden sa nej ({code}).", "The host said no ({code})."),
        "certificate": ("Värdens certifikat", "The host's certificate"),
        "trust": ("Lita på det", "Trust it"),
        "notBuilt": ("Finns inte i appen än. Gör det i webbläsaren eller datorappen.", "Not in the app yet. Do it in the browser or the desktop app."),
        "externalDisplay": ("Extern skärm", "External display"),
        "noServer": ("Demodatan har ingen server. Anslut till kyrkans dator för det här.", "The demo data has no server. Connect to the church's computer for this."),
        "certificateText": ("{host} har ett eget certifikat. Lita bara på det om fingeravtrycket är detsamma som på värden:\n\n{fingerprint}", "{host} has a certificate of its own. Trust it only if the fingerprint is the same as on the host:\n\n{fingerprint}"),
    ]
    guard let pair = table[key] else { return key }
    var text = Texts.language == "en" ? pair.en : pair.sv
    for (name, value) in vars { text = text.replacingOccurrences(of: "{\(name)}", with: value.description) }
    return text
}
