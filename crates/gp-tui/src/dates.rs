// A start page row's second line, as the web's start page and the Mac app's `subtitle` write it: "Idag", "Imorgon" or
// the date (with the year where the list asks), the time and the place, leaving out what is not set.
use crate::texts::{language, t};
use crate::views::PresentationRow;
use chrono::{Locale, NaiveDate};

/// The device's date, `YYYY-MM-DD`, as event dates are stored (`localToday`).
pub fn local_today() -> String { chrono::Local::now().format("%Y-%m-%d").to_string() }

/// `dateLabel` of apps/web/src/pages/dashboard.ts: "Idag", "Imorgon", or "mån 4 maj" (and the year when asked).
pub fn date_label(iso: &str, today: &str, with_year: bool) -> String {
    if iso == today { return t("presentations.today", &[]) }
    let Ok(day) = NaiveDate::parse_from_str(iso, "%Y-%m-%d") else { return iso.to_string() };
    if NaiveDate::parse_from_str(today, "%Y-%m-%d").ok().and_then(|d| d.succ_opt()) == Some(day) { return t("presentations.tomorrow", &[]) }
    let locale = if language() == "en" { Locale::en_GB } else { Locale::sv_SE };
    let format = if with_year { "%a %-d %B %Y" } else { "%a %-d %B" };
    day.format_localized(format, locale).to_string().replace('.', "")
}

/// The row's second line.
pub fn subtitle(p: &PresentationRow, today: &str, show_date: bool, with_year: bool) -> String {
    let [date, time, place] = parts(p, today, show_date, with_year);
    let when: Vec<String> = [date, time].into_iter().filter(|s| !s.is_empty()).collect();
    [when.join(" · "), place].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ")
}

/// The second line's parts apart, each empty when not set: the date (where the list shows it), the time, the place.
pub fn parts(p: &PresentationRow, today: &str, show_date: bool, with_year: bool) -> [String; 3] {
    let date = p.event_date.as_deref().filter(|_| show_date).map(|d| date_label(d, today, with_year)).unwrap_or_default();
    [date, p.time.clone().unwrap_or_default(), p.location.clone().unwrap_or_default()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(date: Option<&str>, time: Option<&str>, location: Option<&str>) -> PresentationRow {
        PresentationRow {
            id: "p".into(), name: "Gudstjänst".into(), event_date: date.map(String::from), time: time.map(String::from),
            location: location.map(String::from), is_template: false, item_count: None,
        }
    }

    #[test]
    fn today_reads_idag() {
        // Arrange, Act
        let label = date_label("2026-11-19", "2026-11-19", false);

        // Assert
        assert_eq!(label, "Idag");
    }

    #[test]
    fn the_next_day_reads_imorgon() {
        // Arrange, Act
        let label = date_label("2026-11-20", "2026-11-19", false);

        // Assert
        assert_eq!(label, "Imorgon");
    }

    #[test]
    fn another_day_reads_its_swedish_weekday_and_month() {
        // Arrange, Act
        let label = date_label("2026-09-20", "2026-11-19", true);

        // Assert
        assert_eq!(label, "sön 20 september 2026");
    }

    #[test]
    fn the_subtitle_leaves_out_what_is_not_set() {
        // Arrange
        let p = row(Some("2026-11-19"), Some("11:00"), None);

        // Act
        let line = subtitle(&p, "2026-11-19", true, false);

        // Assert
        assert_eq!(line, "Idag · 11:00");
    }

    #[test]
    fn the_subtitle_has_the_place_last() {
        // Arrange
        let p = row(Some("2026-09-20"), Some("11:00"), Some("Kyrksalen"));

        // Act
        let line = subtitle(&p, "2026-11-19", false, false);

        // Assert
        assert_eq!(line, "11:00 · Kyrksalen");
    }
}
