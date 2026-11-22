// A presentation's date line, as the core writes it (`dateLineView`, crates/gp-core/src/date_line.rs: "Idag",
// "Imorgon" or "sön 8 november", the time, the place): its parts written in the app's words, together or one by one.
use crate::shell::Core;
use crate::texts::{language, t};
use crate::views::{LinePart, PresentationRow};
use serde_json::json;

/// The device's date, `YYYY-MM-DD`, as event dates are stored (`localToday`).
pub fn local_today() -> String { chrono::Local::now().format("%Y-%m-%d").to_string() }

/// A part in the app's words: a text's key as its text.
fn word(p: &LinePart) -> String { p.key.as_deref().map(|k| t(k, &[])).or_else(|| p.text.clone()).unwrap_or_default() }

/// The line written, its parts joined with " · ".
pub fn written(parts: &[LinePart]) -> String { parts.iter().map(word).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ") }

/// The part that is `of` (date, time, place), written; empty where the line has none.
pub fn part(parts: &[LinePart], of: &str) -> String { parts.iter().find(|p| p.of == of).map(word).unwrap_or_default() }

/// A presentation's line under its title (`dateLineView`), LIVE first while presented here.
pub fn line(core: &Core, p: &PresentationRow, today: &str, live: bool) -> Vec<LinePart> {
    let args = json!({ "today": today, "locale": language(), "eventDate": p.event_date, "time": p.time, "location": p.location, "live": live });
    core.call("dateLineView", args).ok().and_then(|v| serde_json::from_value(v["parts"].clone()).ok()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part_of(key: Option<&str>, text: Option<&str>, of: &str) -> LinePart {
        LinePart { key: key.map(String::from), text: text.map(String::from), of: of.into() }
    }

    #[test]
    fn a_key_is_written_as_the_apps_text_and_the_parts_joined() {
        let parts = [part_of(Some("presentations.today"), None, "date"), part_of(None, Some("11:00"), "time")];

        assert_eq!(written(&parts), "Idag · 11:00");
    }

    #[test]
    fn a_part_is_found_by_what_it_is() {
        let parts = [part_of(None, Some("11:00"), "time"), part_of(None, Some("Kyrksalen"), "place")];

        assert_eq!(part(&parts, "place"), "Kyrksalen");
    }

    #[test]
    fn a_part_not_there_is_empty() {
        assert_eq!(part(&[], "date"), "");
    }
}
