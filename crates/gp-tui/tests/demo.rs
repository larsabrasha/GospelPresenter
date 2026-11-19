// The terminal shell over a copy of the demo data (crates/gp-core/build.sh makes it at
// crates/gp-core/parity/.out/fixtures/demo.sqlite; the fixture itself is never written to): the start page, a
// presentation's page, and presenting by its keys, each through the core's views, and what is drawn from them.
use gp_tui::app::{App, Screen};
use gp_tui::shell::{Caller, Core};
use gp_tui::ui;
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::Terminal;

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../gp-core/parity/.out/fixtures/demo.sqlite");

/// The demo data, copied for this test alone, opened at the same date every run.
fn demo(name: &str) -> App {
    assert!(std::path::Path::new(FIXTURE).exists(), "no demo data: run crates/gp-core/build.sh first");
    let dir = std::env::temp_dir().join(format!("gp-tui-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("demo.sqlite");
    std::fs::copy(FIXTURE, &path).unwrap();
    let core = Core::open(path.to_str().unwrap(), Caller { user_id: "demo".into(), role: "admin".into() }).unwrap();
    App::new(core, "2026-11-19".into())
}

fn press(app: &mut App, code: KeyCode) { app.key(KeyEvent::new(code, KeyModifiers::NONE)) }

/// The demo's Sunday opened and started, its first slide shown.
fn presenting(name: &str) -> App {
    let mut app = demo(name);
    app.open("pres-main");
    press(&mut app, KeyCode::F(5));
    press(&mut app, KeyCode::Char(' '));
    app
}

fn screen(app: &App) -> String {
    let mut terminal = Terminal::new(TestBackend::new(140, 40)).unwrap();
    terminal.draw(|f| ui::draw(f, app)).unwrap();
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height).map(|y| (0..buffer.area.width).map(|x| buffer[(x, y)].symbol()).collect::<String>() + "\n").collect()
}

fn shown(app: &App) -> (Option<&str>, i64) { (app.live.item_id.as_deref(), app.live.part_index) }

#[test]
fn the_start_page_lists_the_demos_presentations() {
    // Arrange, Act
    let app = demo("start");

    // Assert
    let main = app.rows().into_iter().find(|r| r.id == "pres-main").cloned().unwrap();
    assert_eq!(main.item_count, Some(15));
}

#[test]
fn the_start_page_draws_its_lists_titles_and_item_counts() {
    // Arrange
    let app = demo("start-drawn");

    // Act
    let drawn = screen(&app);

    // Assert
    assert!(drawn.contains("Senast ändrade"), "{drawn}");
    assert!(drawn.contains("15 inslag"), "{drawn}");
}

#[test]
fn enter_on_the_start_page_opens_the_row_under_the_cursor() {
    // Arrange
    let mut app = demo("open");
    let first = app.rows()[0].id.clone();

    // Act
    press(&mut app, KeyCode::Enter);

    // Assert
    assert_eq!((app.screen, app.open_id()), (Screen::Page, Some(first.as_str())));
}

#[test]
fn f5_starts_presenting_with_nothing_shown_yet() {
    // Arrange
    let mut app = demo("f5");
    app.open("pres-main");

    // Act
    press(&mut app, KeyCode::F(5));

    // Assert
    assert_eq!((app.live.presentation_id.as_deref(), app.live.item_id.as_deref()), (Some("pres-main"), None));
}

#[test]
fn space_after_starting_shows_the_first_slide() {
    // Arrange, Act
    let app = presenting("space");

    // Assert: the first item has no slides (a heading), so the song after it is shown.
    assert_eq!(shown(&app), (Some("pres-main-i1"), 0));
}

#[test]
fn the_marks_name_the_next_slide() {
    // Arrange, Act
    let app = presenting("marks");

    // Assert
    let next = app.marks.next.as_ref().and_then(|m| m.at()).unwrap();
    assert_eq!((next.item_id.as_str(), next.part_index), ("pres-main-i1", 1));
}

#[test]
fn right_makes_a_slide_ready_and_enter_shows_it() {
    // Arrange
    let mut app = presenting("ready");
    press(&mut app, KeyCode::Right);
    press(&mut app, KeyCode::Right);
    let before = shown(&app).1;

    // Act
    press(&mut app, KeyCode::Enter);

    // Assert
    assert_eq!((before, shown(&app)), (0, (Some("pres-main-i1"), 2)));
}

#[test]
fn b_blacks_the_screen() {
    // Arrange
    let mut app = presenting("black");

    // Act
    press(&mut app, KeyCode::Char('b'));

    // Assert
    assert_eq!((app.live.black, app.shown_slide().is_none(), app.marks.shown.is_none()), (true, true, true));
}

#[test]
fn space_after_slack_shows_a_slide_again() {
    // Arrange
    let mut app = presenting("unblack");
    press(&mut app, KeyCode::Char('b'));

    // Act
    press(&mut app, KeyCode::Char(' '));

    // Assert
    assert_eq!((app.live.black, app.shown_slide().is_some()), (false, true));
}

#[test]
fn the_output_views_arrows_step_what_is_shown() {
    // Arrange
    let mut app = presenting("output");
    press(&mut app, KeyCode::Char('o'));

    // Act
    press(&mut app, KeyCode::Right);
    press(&mut app, KeyCode::Right);
    press(&mut app, KeyCode::Left);

    // Assert
    assert_eq!((app.screen, shown(&app)), (Screen::Output, (Some("pres-main-i1"), 1)));
}

#[test]
fn stepping_past_an_items_last_slide_selects_the_next_item() {
    // Arrange
    let mut app = presenting("follow");
    let slides = app.page.as_ref().unwrap().slides_of("pres-main-i1").len();

    // Act
    for _ in 0..slides { press(&mut app, KeyCode::Char(' ')) }

    // Assert
    assert_eq!((shown(&app), app.state.selected_id.as_deref()), ((Some("pres-main-i2"), 0), Some("pres-main-i2")));
}

#[test]
fn ending_is_asked_first() {
    // Arrange
    let mut app = presenting("ask");

    // Act
    press(&mut app, KeyCode::Char('e'));

    // Assert
    assert_eq!((app.ending, app.live.presentation_id.as_deref()), (true, Some("pres-main")));
}

#[test]
fn ending_confirmed_ends_presenting() {
    // Arrange
    let mut app = presenting("end");
    press(&mut app, KeyCode::Char('e'));

    // Act
    press(&mut app, KeyCode::Enter);

    // Assert
    assert_eq!((app.ending, app.live.presentation_id.as_deref(), app.is_live()), (false, None, false));
}

#[test]
fn another_presentation_cannot_start_while_one_is_presented() {
    // Arrange
    let mut app = presenting("one-at-a-time");
    app.open("pres-0");

    // Act
    press(&mut app, KeyCode::F(5));

    // Assert
    assert_eq!(app.live.presentation_id.as_deref(), Some("pres-main"));
}

#[test]
fn the_page_draws_the_shown_and_next_slides() {
    // Arrange
    let app = presenting("drawn");

    // Act
    let drawn = screen(&app);

    // Assert
    assert!(drawn.contains("VISAS"), "{drawn}");
    assert!(drawn.contains("NÄSTA"), "{drawn}");
    assert!(drawn.contains("Jag går i din kärlek"), "{drawn}");
}

#[test]
fn the_output_view_draws_nothing_after_slack() {
    // Arrange
    let mut app = presenting("drawn-black");
    press(&mut app, KeyCode::Char('o'));
    press(&mut app, KeyCode::Char('b'));

    // Act
    let drawn = screen(&app);

    // Assert
    assert!(!drawn.contains("Jag går i din kärlek"), "{drawn}");
    assert!(drawn.contains("Släck"), "{drawn}");
}

#[test]
fn moving_an_item_changes_the_running_order_in_the_copy() {
    // Arrange
    let mut app = demo("move");
    app.open("pres-main");
    app.key(KeyEvent::new(KeyCode::Down, KeyModifiers::SHIFT));
    app.key(KeyEvent::new(KeyCode::Down, KeyModifiers::SHIFT));

    // Act
    app.key(KeyEvent::new(KeyCode::Up, KeyModifiers::ALT));

    // Assert
    let order: Vec<&str> = app.page.as_ref().unwrap().items.iter().take(2).map(|i| i.id.as_str()).collect();
    assert_eq!(order, ["pres-main-i1", "pres-main-i0"]);
}
