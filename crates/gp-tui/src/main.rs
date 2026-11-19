// `gp <database>`: Gospel Presenter in a terminal, over an organisation's SQLite (docs/tui.md).
use gp_tui::app::App;
use gp_tui::dates::local_today;
use gp_tui::shell::{Caller, Core};
use gp_tui::ui;
use ratatui::crossterm::event::{self, Event, KeyEventKind};

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
    let run = (|| -> std::io::Result<()> {
        while !app.quit {
            terminal.draw(|f| ui::draw(f, &app))?;
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press { app.key(key) }
            }
        }
        Ok(())
    })();
    ratatui::restore();
    if let Err(e) = run { eprintln!("gp: {e}"); std::process::exit(1) }
}
