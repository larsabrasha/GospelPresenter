// This device's own choices from Mina inställningar (the Mac app's `gp.theme` and its language), kept in prefs.json in
// the app's settings folder and applied at the start: the colour theme (system, light or dark, through libadwaita's
// style manager) and the language of the texts (GP_LANG still decides where none is chosen).
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Prefs {
    /// "system", "light" or "dark"; none is the system's.
    pub theme: Option<String>,
    /// "sv" or "en"; none is GP_LANG's, else Swedish.
    pub language: Option<String>,
}

fn file() -> std::path::PathBuf { crate::net::config_dir().join("prefs.json") }

pub fn load() -> Prefs { std::fs::read_to_string(file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default() }

pub fn save(p: &Prefs) {
    if let Ok(text) = serde_json::to_string_pretty(p) {
        if let Err(e) = std::fs::write(file(), text) { eprintln!("gospel-presenter: the settings not kept: {e}") }
    }
}

/// The theme and the language as chosen, now.
pub fn apply(p: &Prefs) {
    let scheme = match p.theme.as_deref() {
        Some("light") => adw::ColorScheme::ForceLight,
        Some("dark") => adw::ColorScheme::ForceDark,
        _ => adw::ColorScheme::Default,
    };
    adw::StyleManager::default().set_color_scheme(scheme);
    if let Some(l) = &p.language { gp_tui::texts::choose(l) }
}

/// The theme chosen, "system" where none is.
pub fn theme(p: &Prefs) -> &str { p.theme.as_deref().unwrap_or("system") }
