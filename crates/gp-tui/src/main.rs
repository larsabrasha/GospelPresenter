// `gp <database>`: Gospel Presenter in a terminal, over an organisation's SQLite (docs/tui.md).
use gp_tui::app::App;
use gp_tui::dates::local_today;
use gp_tui::shell::{Caller, Core};
use gp_tui::ui;
use ratatui::crossterm::event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind, MouseButton, MouseEventKind};
use ratatui::crossterm::execute;
use std::io::stdout;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: gp <path to an organisation's SQLite>");
        std::process::exit(2);
    };
    // The demo's caller, as the Mac app's demo runs: no sign-in yet (docs/tui.md, "Left").
    let core = match Core::open(&path, Caller { user_id: "demo".into(), role: "admin".into() }) {
        Ok(core) => core,
        Err(e) => { eprintln!("gp: {e}"); std::process::exit(1) }
    };
    let mut app = App::new(core, local_today());
    let mut terminal = ratatui::init();
    // Clicks, which a terminal sends as text, over SSH too; the terminal is given its mouse back on a panic as well.
    let _ = execute!(stdout(), EnableMouseCapture);
    let restore = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = execute!(stdout(), DisableMouseCapture);
        restore(info);
    }));
    let run = (|| -> std::io::Result<()> {
        let mut hits = ui::Hits::new();
        while !app.quit {
            terminal.draw(|f| hits = ui::draw(f, &app))?;
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => app.key(key),
                Event::Mouse(m) if m.kind == MouseEventKind::Down(MouseButton::Left) => {
                    if let Some(target) = ui::target_at(&hits, m.column, m.row).cloned() { app.click(&target) }
                }
                _ => {}
            }
        }
        Ok(())
    })();
    let _ = execute!(stdout(), DisableMouseCapture);
    ratatui::restore();
    if let Err(e) = run { eprintln!("gp: {e}"); std::process::exit(1) }
}
