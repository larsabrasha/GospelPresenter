use super::*;

fn line(p: Value, today: &str) -> Value {
    let mut a = p.as_object().unwrap().clone();
    a.insert("today".into(), json!(today));
    view(&a).unwrap()["parts"].clone()
}

#[test]
fn today_is_idag_by_key() {
    assert_eq!(date_label("2026-11-22", "2026-11-22", false, false), json!({ "key": "presentations.today" }));
}

#[test]
fn the_next_day_is_imorgon_by_key() {
    assert_eq!(date_label("2026-11-23", "2026-11-22", false, false), json!({ "key": "presentations.tomorrow" }));
}

#[test]
fn the_next_day_over_a_new_year_is_imorgon() {
    assert_eq!(date_label("2027-01-01", "2026-12-31", false, false), json!({ "key": "presentations.tomorrow" }));
}

#[test]
fn another_day_is_its_swedish_weekday_day_and_month() {
    assert_eq!(date_label("2026-11-08", "2026-11-22", false, false), json!({ "text": "sön 8 november" }));
}

#[test]
fn the_year_follows_where_asked() {
    assert_eq!(date_label("2026-09-20", "2026-11-22", true, false), json!({ "text": "sön 20 september 2026" }));
}

#[test]
fn english_writes_the_english_names() {
    assert_eq!(date_label("2026-11-26", "2026-11-22", false, true), json!({ "text": "Thu 26 November" }));
}

#[test]
fn a_leap_day_is_a_date() {
    assert_eq!(date_label("2028-02-29", "2026-11-22", true, false), json!({ "text": "tis 29 februari 2028" }));
}

#[test]
fn a_text_that_is_not_a_date_is_kept_as_it_is() {
    assert_eq!(date_label("2026-02-30", "2026-11-22", false, false), json!({ "text": "2026-02-30" }));
}

#[test]
fn the_line_is_the_date_the_time_and_the_place() {
    let out = line(json!({ "eventDate": "2026-11-22", "time": "11:00", "location": "Kyrksalen" }), "2026-11-22");

    assert_eq!(out, json!([{ "key": "presentations.today", "of": "date" }, { "text": "11:00", "of": "time" }, { "text": "Kyrksalen", "of": "place" }]));
}

#[test]
fn the_line_leaves_out_what_is_not_set() {
    let out = line(json!({ "eventDate": null, "time": "", "location": "Kyrksalen" }), "2026-11-22");

    assert_eq!(out, json!([{ "text": "Kyrksalen", "of": "place" }]));
}

#[test]
fn the_line_leaves_out_the_date_where_the_list_does_not_show_it() {
    let out = line(json!({ "eventDate": "2026-11-22", "time": "11:00", "showDate": false }), "2026-11-22");

    assert_eq!(out, json!([{ "text": "11:00", "of": "time" }]));
}

#[test]
fn live_comes_first_while_presented_here() {
    let out = line(json!({ "eventDate": "2026-11-22", "live": true }), "2026-11-22");

    assert_eq!(out, json!([{ "key": "live.badge", "of": "live" }, { "key": "presentations.today", "of": "date" }]));
}
