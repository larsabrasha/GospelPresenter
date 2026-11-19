// What the tests over the demo data share: a copy of it opened, keys pressed, the screen drawn at a size, and a click or
// the wheel where a text is drawn. Each test file uses some of it.
#![allow(dead_code)]
use gp_tui::app::App;
use gp_tui::shell::{Caller, Core};
use gp_tui::ui;
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::Terminal;

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../gp-core/parity/.out/fixtures/demo.sqlite");

/// A computer's terminal, and a phone's held upright over SSH (the picture Lars sent, 2026-11-19: about 50 columns).
pub const WIDE: (u16, u16) = (140, 40);
pub const PHONE: (u16, u16) = (50, 40);

/// The demo data, copied for this test alone, opened at the same date every run.
pub fn demo(name: &str) -> App {
    assert!(std::path::Path::new(FIXTURE).exists(), "no demo data: run crates/gp-core/build.sh first");
    let dir = std::env::temp_dir().join(format!("gp-tui-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("demo.sqlite");
    std::fs::copy(FIXTURE, &path).unwrap();
    let core = Core::open(path.to_str().unwrap(), Caller { user_id: "demo".into(), role: "admin".into() }).unwrap();
    App::new(core, "2026-11-19".into())
}

pub fn press(app: &mut App, code: KeyCode) { app.key(KeyEvent::new(code, KeyModifiers::NONE)) }

/// The demo's Sunday opened and started, its first slide shown.
pub fn presenting(name: &str) -> App {
    let mut app = demo(name);
    app.open("pres-main");
    press(&mut app, KeyCode::F(5));
    press(&mut app, KeyCode::Char(' '));
    app
}

/// The screen drawn at `size`, as text, and where each thing a click can hit landed.
pub fn drawn_in(app: &App, (w, h): (u16, u16)) -> (Vec<String>, ui::Hits) {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    let mut hits = ui::Hits::new();
    terminal.draw(|f| hits = ui::draw(f, app)).unwrap();
    let buffer = terminal.backend().buffer();
    let rows = (0..buffer.area.height).map(|y| (0..buffer.area.width).map(|x| buffer[(x, y)].symbol()).collect::<String>()).collect();
    (rows, hits)
}

pub fn screen_in(app: &App, size: (u16, u16)) -> String { drawn_in(app, size).0.join("\n") }
pub fn screen(app: &App) -> String { screen_in(app, WIDE) }

/// The first place, top to bottom, where `text` is drawn at `size`, and where everything landed.
fn find(app: &App, size: (u16, u16), text: &str) -> ((u16, u16), ui::Hits) {
    let (rows, hits) = drawn_in(app, size);
    let at = rows.iter().enumerate().find_map(|(y, row)| row.find(text).map(|i| (row[..i].chars().count() as u16, y as u16)))
        .unwrap_or_else(|| panic!("{text} is not drawn:\n{}", rows.join("\n")));
    (at, hits)
}

/// A click where `text` is drawn at `size`.
pub fn click_in(app: &mut App, size: (u16, u16), text: &str) {
    let ((x, y), hits) = find(app, size, text);
    if let Some(target) = ui::target_at(&hits, x, y).cloned() { app.click(&target) }
}

pub fn click_on(app: &mut App, text: &str) { click_in(app, WIDE, text) }

/// The wheel turned `lines` over where `text` is drawn at `size` (a swipe on a phone's SSH app sends the same).
pub fn wheel_in(app: &mut App, size: (u16, u16), text: &str, lines: i32) {
    let ((x, y), hits) = find(app, size, text);
    if let Some(pane) = ui::pane_at(&hits, x, y) { app.wheel(pane, lines) }
}

pub fn shown(app: &App) -> (Option<&str>, i64) { (app.live.item_id.as_deref(), app.live.part_index) }
