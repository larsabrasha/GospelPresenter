// The app's texts: the web's (apps/web/src/i18n.ts, read by build.rs), Swedish unless GP_LANG=en, as the web's default.
// Keys as the web's: `t("presentations.today")`.
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

type Table = HashMap<String, HashMap<String, String>>;

fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/texts.json"))).unwrap_or_default())
}

/// The language chosen while the app runs (`choose`): 0 none yet, 1 Swedish, 2 English.
static CHOSEN: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// "sv" or "en": the one chosen (Mina inställningar's Språk), else GP_LANG's when it is English, else Swedish.
pub fn language() -> &'static str {
    match CHOSEN.load(std::sync::atomic::Ordering::Relaxed) {
        1 => return "sv",
        2 => return "en",
        _ => {}
    }
    static LANG: OnceLock<&'static str> = OnceLock::new();
    LANG.get_or_init(|| if std::env::var("GP_LANG").is_ok_and(|l| l.starts_with("en")) { "en" } else { "sv" })
}

/// The app's language from now on: "en" English, anything else Swedish.
pub fn choose(language: &str) { CHOSEN.store(if language == "en" { 2 } else { 1 }, std::sync::atomic::Ordering::Relaxed) }

/// The text for `key` in the app's language, its `{name}` placeholders filled from `vars`; the key itself when there
/// is none.
pub fn t(key: &str, vars: &[(&str, &str)]) -> String {
    let tables = table();
    let mut text = tables.get(language()).and_then(|l| l.get(key)).or_else(|| tables.get("sv").and_then(|l| l.get(key)))
        .cloned().unwrap_or_else(|| key.to_string());
    for (name, value) in vars { text = text.replace(&format!("{{{name}}}"), value) }
    text
}

/// The text a view names by key, as JSON hands it (a list's title, a cue's text).
pub fn t_of(key: &Value) -> String { key.as_str().map(|k| t(k, &[])).unwrap_or_default() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_reads_the_apps_swedish_text() {
        // Arrange, Act
        let text = t("live.clear", &[]);

        // Assert
        assert_eq!(text, "Släck");
    }

    #[test]
    fn placeholders_are_filled() {
        // Arrange, Act
        let text = t("presentations.items", &[("n", "4")]);

        // Assert
        assert_eq!(text, "4 inslag");
    }

    #[test]
    fn an_unknown_key_reads_as_itself() {
        // Arrange, Act
        let text = t("no.such.key", &[]);

        // Assert
        assert_eq!(text, "no.such.key");
    }
}
