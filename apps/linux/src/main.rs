// Gospel Presenter for Linux (docs/linux-app.md): GTK 4 and libadwaita over the Rust core, linked in as a crate. The
// core decides what each page shows and what each key and tap does, through the terminal shell's App
// (crates/gp-tui/src/app.rs); this draws it with GTK's own widgets and paints slides from the core's layout.
mod adding;
mod adding_bible;
mod autosave;
mod connect;
mod details;
mod faces;
mod image_items;
mod item_menu;
mod keys;
mod layout;
mod live;
mod media;
mod look;
mod model;
mod net;
mod output;
mod outputs;
mod pair_screen;
mod painter;
mod palette;
mod player;
mod player_bar;
mod presentation;
mod presentation_menu;
mod prefs;
mod settings;
mod settings_mine;
mod settings_trash;
mod shell;
mod start_page;
mod song_page;
mod sync;
mod templates;
mod ticking;
mod tiles;

use adw::prelude::*;
use std::path::PathBuf;

/// A database named to open as the demo is: the first argument, else GP_DB; none, and the app signs in to a host.
pub fn db_given() -> Option<PathBuf> {
    std::env::args().nth(1).or_else(|| std::env::var("GP_DB").ok()).filter(|p| !p.is_empty()).map(PathBuf::from)
}

fn main() -> gtk::glib::ExitCode {
    let app = adw::Application::builder()
        .application_id("com.gospelpresenter.Linux")
        .flags(gtk::gio::ApplicationFlags::NON_UNIQUE)
        .build();
    app.connect_activate(shell::Shell::start);
    // The arguments are the app's own (the database), not GApplication's.
    app.run_with_args::<&str>(&[])
}
