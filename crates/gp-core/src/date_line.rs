// A presentation's date line, the same in every shell (Lars, 2026-11-22: the shells' own versions were the second rule
// written twice): "Idag", "Imorgon" or the date ("sön 8 november", the year where asked), the time and the place,
// leaving out what is not set; the web's dashboard.ts `dateLabel` and start page row. The words are the app's texts by
// key where the web has one (Idag, Imorgon, LIVE), and a day's and a month's names here, in Swedish or English, as the
// web's Intl writes them (packages/rust-core/test/date-line.test.ts).
use crate::args::*;
use crate::view_types::{DateLine, LinePart};
use serde_json::{json, Value};

const WEEKDAYS_SV: [&str; 7] = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];
const WEEKDAYS_EN: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SV: [&str; 12] = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MONTHS_EN: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// `YYYY-MM-DD` as (year, month, day); none when it is not a date.
fn parse(iso: &str) -> Option<(i64, u32, u32)> {
    let mut it = iso.splitn(3, '-');
    let (y, m, d) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    ((1..=12).contains(&m) && d >= 1 && d <= days_in(y, m)).then_some((y, m, d))
}

fn leap(y: i64) -> bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }
fn days_in(y: i64, m: u32) -> u32 { [31, if leap(y) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(m - 1) as usize] }

/// The day after.
fn next((y, m, d): (i64, u32, u32)) -> (i64, u32, u32) {
    if d < days_in(y, m) { (y, m, d + 1) } else if m < 12 { (y, m + 1, 1) } else { (y + 1, 1, 1) }
}

/// The day of the week, 0 for Sunday (Sakamoto's).
fn weekday((y, m, d): (i64, u32, u32)) -> usize {
    const T: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    ((y + y / 4 - y / 100 + y / 400 + T[(m - 1) as usize] + d as i64).rem_euclid(7)) as usize
}

/// A date's part of the line: {key} for Idag and Imorgon, else {text} ("sön 8 november", the year when asked); the
/// text as stored where it is not a date.
pub fn date_label(iso: &str, today: &str, with_year: bool, en: bool) -> Value {
    if iso == today { return json!({ "key": "presentations.today" }) }
    let Some(day) = parse(iso) else { return json!({ "text": iso }) };
    if parse(today).map(next) == Some(day) { return json!({ "key": "presentations.tomorrow" }) }
    let (days, months) = if en { (WEEKDAYS_EN, MONTHS_EN) } else { (WEEKDAYS_SV, MONTHS_SV) };
    let mut text = format!("{} {} {}", days[weekday(day)], day.2, months[(day.1 - 1) as usize]);
    if with_year { text = format!("{text} {}", day.0) }
    json!({ "text": text })
}

/// The line's parts, in order, each {key} or {text} and what it is (`of`: live, date, time, place), what is not set
/// left out: LIVE first while presented here, the date where shown, the time, the place. The shell writes each (a key
/// as the app's text) and joins them with " · ", or sets them in columns by `of`.
#[allow(clippy::too_many_arguments)]
pub fn line(date: Option<&str>, time: Option<&str>, place: Option<&str>, today: &str, show_date: bool, with_year: bool, en: bool, live: bool) -> Vec<LinePart> {
    let text = |t: &str, of: &str| LinePart { key: None, text: Some(t.to_string()), of: of.into() };
    let mut out = vec![];
    if live { out.push(LinePart { key: Some("live.badge".into()), text: None, of: "live".into() }) }
    if let Some(d) = date.filter(|d| show_date && !d.is_empty()) {
        let label = date_label(d, today, with_year, en);
        out.push(LinePart { key: label["key"].as_str().map(String::from), text: label["text"].as_str().map(String::from), of: "date".into() });
    }
    for (v, of) in [(time, "time"), (place, "place")] {
        if let Some(v) = v.filter(|v| !v.trim().is_empty()) { out.push(text(v, of)) }
    }
    out
}

/// `line` of a presentation as JSON gives it, as JSON.
pub fn parts(p: &Value, today: &str, show_date: bool, with_year: bool, en: bool, live: bool) -> Value {
    let s = |k: &str| p[k].as_str();
    serde_json::to_value(line(s("eventDate"), s("time"), s("location"), today, show_date, with_year, en, live)).unwrap_or(Value::Null)
}

/// English where the locale says so, else Swedish, as the web's default.
pub fn english(a: &Obj) -> bool { a.get("locale").and_then(Value::as_str).is_some_and(|l| l.starts_with("en")) }

/// `dateLineView` {today, locale, eventDate?, time?, location?, showDate?, withYear?, live?}: a presentation's date
/// line (under its title, a start page row's second line): {parts}, see `parts`. `showDate` true and `withYear` false
/// unless given.
pub fn view(a: &Obj) -> R<Value> {
    let today = a.get("today").and_then(Value::as_str).ok_or("invalid-args")?;
    let flag = |k: &str, or: bool| a.get(k).and_then(Value::as_bool).unwrap_or(or);
    let s = |k: &str| a.get(k).and_then(Value::as_str);
    let parts = line(s("eventDate"), s("time"), s("location"), today, flag("showDate", true), flag("withYear", false), english(a), flag("live", false));
    serde_json::to_value(DateLine { parts }).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "date_line_tests.rs"]
mod tests;
