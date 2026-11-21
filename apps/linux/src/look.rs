// The core's look (lookView, crates/gp-core/src/look.rs) as GTK draws it: the page's greys are libadwaita's own, light
// and dark as the system has them (the `system` roles: the platform's colour for the role); the app's accent, sky,
// where the user has chosen none (libadwaita follows the system's accent where the desktop offers one); ▶ Starta in
// emerald and ■ Avsluta in red, as filled buttons (`suggested-action`, `destructive-action`); the marks VISAS and the
// slide made ready in red and the accent.
use serde_json::Value;

/// The core's lookView. It reads no database, so it runs to its end at once.
pub fn read() -> Value {
    match gp_core::start(serde_json::json!({ "name": "lookView", "args": {}, "ctx": {} })) {
        gp_core::Step::Done(v) => v,
        _ => Value::Null,
    }
}

/// The accent now, as painted by hand (the ring of the slide made ready): the user's where the desktop offers one,
/// else the app's own, light or dark.
pub fn accent() -> gtk::gdk::RGBA {
    let styles = adw::StyleManager::default();
    if styles.is_system_supports_accent_colors() { return styles.accent_color_rgba() }
    thread_local! { static LOOK: Value = read(); }
    let hex_now = LOOK.with(|look| hex(look, look["accent"].as_str().unwrap_or("sky"), styles.is_dark()));
    gtk::gdk::RGBA::parse(hex_now).unwrap_or(gtk::gdk::RGBA::BLUE)
}

/// A colour of the table by its name, light or dark.
fn hex(look: &Value, name: &str, dark: bool) -> String {
    look["colors"][name][if dark { "dark" } else { "light" }]["hex"].as_str().unwrap_or("#000000").to_string()
}

/// The CSS for the style manager's mode: the accent only where the user has none of their own (`accentFollowsUser`).
pub fn css(look: &Value, dark: bool, user_accent: bool) -> String {
    let accent = look["accent"].as_str().unwrap_or("sky");
    let role = |r: &str| look["roles"][r]["color"].as_str().map(|c| hex(look, c, dark)).unwrap_or_default();
    let mut css = String::new();
    if !(user_accent && look["accentFollowsUser"].as_bool().unwrap_or(false)) {
        css += &format!(":root {{ --accent-bg-color: {0}; --accent-color: {0}; }}\n", hex(look, accent, dark));
    }
    css += &format!("button.start {{ background-color: {}; color: white; }}\n", role("start"));
    css += &format!("button.end {{ background-color: {}; color: white; }}\n", role("end"));
    css += &format!(".live-badge {{ color: {}; font-weight: bold; }}\n", hex(look, "red", dark));
    css += "row.selected-item { background-color: alpha(var(--accent-bg-color), 0.15); }\n";
    css += ".slide-heading { font-weight: bold; margin: 12px 6px 4px 6px; }\n";
    css += ".live-picture { background-color: black; border-radius: 12px; }\n";
    css
}

/// The CSS applied to the display now, and again whenever the system's light or dark mode or accent changes.
pub fn apply(look: Value) {
    let provider = gtk::CssProvider::new();
    let display = gtk::gdk::Display::default().expect("a display");
    gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    let styles = adw::StyleManager::default();
    let load = move |s: &adw::StyleManager| provider.load_from_string(&css(&look, s.is_dark(), s.is_system_supports_accent_colors()));
    load(&styles);
    styles.connect_dark_notify(load.clone());
    styles.connect_accent_color_notify(load);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_apps_sky_is_the_accent_where_the_user_has_none() {
        // Arrange
        let look = read();

        // Act
        let css = css(&look, false, false);

        // Assert
        assert!(css.contains("--accent-bg-color: #0ea5e9"));
    }

    #[test]
    fn the_users_accent_goes_before_the_apps() {
        // Arrange
        let look = read();

        // Act
        let css = css(&look, false, true);

        // Assert
        assert!(!css.contains("--accent-bg-color:"));
    }

    #[test]
    fn starta_is_emerald() {
        // Arrange
        let look = read();

        // Act
        let css = css(&look, true, false);

        // Assert
        assert!(css.contains("button.start { background-color: #10b981"));
    }
}
