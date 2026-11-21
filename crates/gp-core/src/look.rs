// The app's colours and what each kind of button is, one table for every shell (Lars, 2026-11-21): the web, the Mac and
// iOS, Windows and Linux after them, each drawing a role with its own platform's buttons (Liquid Glass on a Mac, WinUI,
// GTK) in the colour named here. Which button a page has, its text and its role are the views' (page_models.rs
// `pageButtonsView`, the menus' actions); how a role looks on a platform, its icon and its size are the shell's
// (docs/view-models.md, "What stays a shell's"). The colours are the web's Tailwind ones (apps/web/src/app.css), by
// their Tailwind names; nothing checks them against the web's classes yet, so a colour changed there is changed here
// by hand.
use serde_json::{json, Value};

/// A colour by its Tailwind name and hex, light and dark.
fn colour(light: (&str, &str), dark: (&str, &str)) -> Value {
    json!({ "light": { "name": light.0, "hex": light.1 }, "dark": { "name": dark.0, "hex": dark.1 }, "system": null })
}

/// A colour of the page's ground, which a platform with a colour of its own for that role draws in its own (`system`:
/// the role, as Apple names it), light and dark as the platform has them; the web, which has none, in the hex (Lars,
/// 2026-11-21: follow the platform's standard).
fn system_colour(system: &str, light: (&str, &str), dark: (&str, &str)) -> Value {
    let mut c = colour(light, dark);
    c["system"] = json!(system);
    c
}

/// `lookView`: `app`, the app's name and the repository's picture of its icon; `accent`, the app's own colour (a name of `colors`); `accentFollowsUser`, whether a user's own accent
/// goes before it where they chose one; `colors`, each by role in the page (the app's sky, ▶'s emerald, ■'s and a destructive action's red,
/// the page's warm greys), light and dark; and `roles`, each kind of button with its colour and its weight: `filled`
/// for what a page is for (the + of a list, Lägg till, ▶ Starta, ■ Avsluta, a sheet's Spara), `tinted` for a quiet one
/// in a colour, `standard` for the platform's own push button in no colour (Släck), `plain` for a menu's entry or Avbryt
/// (in its colour, if it has one), `glass` for the bar's and the columns' own (‹ back, fold a column, the account).
pub fn view() -> Value {
    json!({
        // The app as every shell names it and draws its icon: the name in the menu bar, the Dock, the window and the
        // installer, and the one picture each platform's icons are made from (Lars, 2026-11-21).
        "app": { "name": "Gospel Presenter", "icon": "apps/desktop/build/icon.png" },
        // The app's own colour, its accent: a platform where the user chooses an accent of their own (a Mac's) follows
        // the user's instead, as a native app does; Multicolour, the default, leaves it to the app (Lars, 2026-11-21).
        "accent": "sky",
        // Whether a user's own accent goes before the app's: on a platform where the user chooses one and has (a Mac's
        // System Settings › Appearance but for Multicolour, Windows' Personalisation › Colours when not automatic),
        // the user's; else the app's. A rule for every shell, which each tells by its platform's own setting.
        "accentFollowsUser": true,
        "colors": {
            "sky": colour(("sky-500", "#0ea5e9"), ("sky-500", "#0ea5e9")),
            "emerald": colour(("emerald-500", "#10b981"), ("emerald-500", "#10b981")),
            "red": colour(("red-500", "#ef4444"), ("red-500", "#ef4444")),
            // The page under grouped lists and columns; the cards and rows on it; a field or pill on those; the side
            // column; secondary words. Each a role a Mac and iOS have a colour of their own for.
            "ground": system_colour("groupedBackground", ("stone-100", "#f5f5f4"), ("stone-950", "#0c0a09")),
            "surface": system_colour("secondaryGroupedBackground", ("white", "#ffffff"), ("stone-900", "#1c1917")),
            "raised": system_colour("fill", ("stone-100", "#f5f5f4"), ("stone-800", "#292524")),
            "sidebar": system_colour("sidebar", ("stone-150", "#eeedec"), ("stone-975", "#090807")),
            "quiet": system_colour("secondaryLabel", ("stone-500", "#78716c"), ("stone-400", "#a8a29e")),
        },
        "roles": {
            "add": { "color": "sky", "weight": "filled" },
            "confirm": { "color": "sky", "weight": "filled" },
            "start": { "color": "emerald", "weight": "filled" },
            "end": { "color": "red", "weight": "filled" },
            "tinted": { "color": "sky", "weight": "tinted" },
            "destructive": { "color": "red", "weight": "plain" },
            "standard": { "color": null, "weight": "standard" },
            "cancel": { "color": null, "weight": "plain" },
            "default": { "color": null, "weight": "plain" },
            "quiet": { "color": null, "weight": "glass" },
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_role_names_a_colour_of_the_table_or_none() {
        let look = view();

        let unknown: Vec<&String> = look["roles"].as_object().unwrap().iter()
            .filter(|(_, r)| !r["color"].is_null() && look["colors"].get(r["color"].as_str().unwrap()).is_none())
            .map(|(k, _)| k).collect();

        assert!(unknown.is_empty(), "{unknown:?}");
    }

    #[test]
    fn the_app_is_named_gospel_presenter() {
        assert_eq!(view()["app"]["name"], json!("Gospel Presenter"));
    }

    #[test]
    fn a_users_own_accent_goes_before_the_apps() {
        assert_eq!(view()["accentFollowsUser"], json!(true));
    }

    #[test]
    fn the_accent_is_a_colour_of_the_table() {
        let look = view();

        assert!(look["colors"].get(look["accent"].as_str().unwrap()).is_some());
    }
}
