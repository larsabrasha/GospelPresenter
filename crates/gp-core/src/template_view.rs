// A template's weekly slot (spec 03 "Template"; the web's templates.ts, the core's since 2026-11-22): the line under
// its name in a list and the date a presentation made from it is prefilled with, the same in every shell.
use crate::args::*;
use serde_json::{json, Value};

/// The weekday of a plain date `YYYY-MM-DD`, 0 for Sunday (Sakamoto's method), as JavaScript's getDay counts.
fn weekday_of(date: &str) -> i64 {
    let n: Vec<i64> = date.split('-').map(|p| p.parse().unwrap_or(0)).collect();
    let (mut y, m, d) = (n.first().copied().unwrap_or(1970), n.get(1).copied().unwrap_or(1), n.get(2).copied().unwrap_or(1));
    const T: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    if m < 3 { y -= 1 }
    (y + y / 4 - y / 100 + y / 400 + T[((m - 1).clamp(0, 11)) as usize] + d).rem_euclid(7)
}

/// `templateView` {template: {weekday, time, location}, today, now}: `schedule`, its day (a text's key, `weekday.N`)
/// and its time, either alone, `location`, and `nextDate`, the date a presentation from it is prefilled with: the next
/// time its weekday comes, today if that is today and its time (`now`, `HH:MM`) has not passed (or it has no time),
/// else a week on; empty without a weekday. A list's line is the schedule's parts joined by a space, then the place
/// after " · ".
pub fn view(a: &Obj) -> R<Value> {
    let tp = obj(a.get("template").ok_or("invalid-args")?)?;
    let weekday = tp.get("weekday").and_then(Value::as_i64).filter(|d| (0..7).contains(d));
    let time = tp.get("time").and_then(Value::as_str).filter(|s| !s.is_empty());
    let location = tp.get("location").and_then(Value::as_str).filter(|s| !s.is_empty());
    let today = a.get("today").and_then(Value::as_str).ok_or("invalid-args")?;
    let now = a.get("now").and_then(Value::as_str).unwrap_or("00:00");
    let next = weekday.map_or(String::new(), |day| {
        let mut days = (day - weekday_of(today)).rem_euclid(7);
        if days == 0 && time.is_some_and(|t| now >= t) { days = 7 }
        crate::media_wanted::add_days(today, days)
    });
    Ok(json!({
        "schedule": { "day": weekday.map(|d| format!("weekday.{d}")), "time": time },
        "location": location,
        "nextDate": next,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn of(weekday: Value, time: Value, today: &str, now: &str) -> Value {
        view(json!({ "template": { "weekday": weekday, "time": time, "location": null }, "today": today, "now": now }).as_object().unwrap()).unwrap()
    }

    #[test]
    fn the_next_sunday_from_a_wednesday() {
        // 2026-11-18 is a Wednesday.
        assert_eq!(of(json!(0), json!("11:00"), "2026-11-18", "09:00")["nextDate"], json!("2026-11-22"));
    }

    #[test]
    fn today_while_its_time_has_not_passed() {
        assert_eq!(of(json!(0), json!("11:00"), "2026-11-22", "10:59")["nextDate"], json!("2026-11-22"));
    }

    #[test]
    fn a_week_on_once_its_time_has_passed() {
        assert_eq!(of(json!(0), json!("11:00"), "2026-11-22", "11:00")["nextDate"], json!("2026-11-29"));
    }

    #[test]
    fn today_without_a_time() {
        assert_eq!(of(json!(0), Value::Null, "2026-11-22", "23:59")["nextDate"], json!("2026-11-22"));
    }

    #[test]
    fn no_date_without_a_weekday() {
        assert_eq!(of(Value::Null, json!("11:00"), "2026-11-22", "09:00")["nextDate"], json!(""));
    }

    #[test]
    fn across_a_year_end() {
        // 2026-12-31 is a Thursday; the next Monday is 2027-01-04.
        assert_eq!(of(json!(1), Value::Null, "2026-12-31", "09:00")["nextDate"], json!("2027-01-04"));
    }

    #[test]
    fn the_schedule_names_its_day_by_its_texts_key() {
        assert_eq!(of(json!(3), json!("18:30"), "2026-11-22", "09:00")["schedule"], json!({ "day": "weekday.3", "time": "18:30" }));
    }

    #[test]
    fn a_weekday_reads_as_javascripts() {
        assert_eq!(weekday_of("2026-11-22"), 0);
        assert_eq!(weekday_of("2024-02-29"), 4);
    }
}
