// A narrow terminal (a phone over SSH) and the wheel, over a copy of the demo data: one column with every slide's whole
// text, what is shown at the top with Släck, clicks in it, and lists the wheel or a swipe moves.
mod common;
use common::*;
use ratatui::crossterm::event::KeyCode;

#[test]
fn a_narrow_terminal_draws_the_whole_running_order_with_every_slides_text() {
    // Arrange
    let mut app = demo("phone-column");

    // Act
    app.open("pres-main");

    // Assert: the chorus's third line, which the wide layout's slide rows leave out.
    let drawn = screen_in(&app, PHONE);
    assert!(drawn.contains("Simon välkomnar") && drawn.contains("Evigt går min själ"), "{drawn}");
}

#[test]
fn a_narrow_terminal_shows_what_is_shown_at_the_top_with_slack_beside_it() {
    // Arrange, Act
    let app = presenting("phone-top");

    // Assert
    let drawn = screen_in(&app, PHONE);
    let top: Vec<&str> = drawn.lines().skip(2).take(3).collect();
    assert!(top[0].contains("VISAS") && top[1].contains("Jag går i din kärlek") && top[1].contains("Släck"), "{drawn}");
}

#[test]
fn a_click_on_slack_blacks_the_screen() {
    // Arrange
    let mut app = presenting("phone-black");

    // Act
    click_in(&mut app, PHONE, "Släck");

    // Assert
    assert!(app.live.black);
}

#[test]
fn a_click_on_a_slide_in_the_column_shows_it() {
    // Arrange
    let mut app = presenting("phone-show");

    // Act
    click_in(&mut app, PHONE, "Genom stormens brus");

    // Assert
    assert_eq!(shown(&app), (Some("pres-main-i1"), 1));
}

#[test]
fn the_wheel_moves_the_column() {
    // Arrange
    let mut app = presenting("phone-wheel");

    // Act
    wheel_in(&mut app, PHONE, "Genom stormens brus", 60);

    // Assert
    let drawn = screen_in(&app, PHONE);
    assert!(!drawn.contains("Genom stormens brus"), "{drawn}");
}

#[test]
fn a_key_after_the_wheel_brings_the_shown_slide_back_in_sight() {
    // Arrange
    let mut app = presenting("phone-follow");
    wheel_in(&mut app, PHONE, "Genom stormens brus", 60);
    screen_in(&app, PHONE);

    // Act
    press(&mut app, KeyCode::Char(' '));

    // Assert
    let drawn = screen_in(&app, PHONE);
    assert!(drawn.lines().skip(5).any(|l| l.contains("Genom stormens brus")), "{drawn}");
}

#[test]
fn the_wheel_moves_the_start_page_on_a_short_terminal() {
    // Arrange
    let mut app = demo("start-wheel");

    // Act
    wheel_in(&mut app, (140, 12), "Kvällssamling", 6);

    // Assert
    let drawn = screen_in(&app, (140, 12));
    assert!(!drawn.contains("Presentationer"), "{drawn}");
}

/// Where `text` begins on the first line that has it, in characters.
fn column_of(drawn: &str, text: &str) -> usize {
    drawn.lines().find_map(|l| l.find(text).map(|i| l[..i].chars().count())).unwrap_or_else(|| panic!("{text} is not drawn:\n{drawn}"))
}

#[test]
fn the_start_pages_dates_and_times_stand_in_columns() {
    // Arrange
    let app = demo("start-columns");

    // Act
    let drawn = screen_in(&app, WIDE);

    // Assert: a short name and a long one, a day of one digit and one of two.
    let dates = [column_of(&drawn, "sön  8 november"), column_of(&drawn, "lör 12 september"), column_of(&drawn, "fre  3 april")];
    let times = [column_of(&drawn, "11:00 "), column_of(&drawn, "19:00"), column_of(&drawn, "17:00")];
    assert!(dates.iter().all(|d| *d == dates[0]) && times.iter().all(|t| *t == times[0]), "{drawn}");
}

#[test]
fn the_start_pages_numbers_of_items_end_in_one_column() {
    // Arrange
    let app = demo("start-counts");

    // Act
    let drawn = screen_in(&app, WIDE);

    // Assert
    let ends = ["15 inslag", " 7 inslag", "1 inslag"].map(|n| column_of(&drawn, n) + n.chars().count());
    assert!(ends.iter().all(|e| *e == ends[0]), "{drawn}");
}

#[test]
fn a_narrow_start_page_puts_the_date_under_the_name() {
    // Arrange
    let app = demo("start-narrow");

    // Act
    let drawn = screen_in(&app, PHONE);

    // Assert
    let lines: Vec<&str> = drawn.lines().collect();
    let at = lines.iter().position(|l| l.contains("Nattvardsgudstjänst")).unwrap();
    assert!(lines[at + 1].contains("sön 6 september 2026 · 11:00 · 20 inslag"), "{drawn}");
}

#[test]
fn a_wide_terminal_keeps_three_columns() {
    // Arrange
    let mut app = demo("wide");

    // Act
    app.open("pres-main");

    // Assert: the slides' column, titled by the item selected.
    let drawn = screen_in(&app, WIDE);
    assert!(drawn.contains("┌ Simon välkomnar"), "{drawn}");
}
