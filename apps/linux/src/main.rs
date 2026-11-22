// Gospel Presenter for Linux (docs/linux-app.md): GTK 4 and libadwaita over the Rust core, linked in as a crate. The
// core decides what each page shows and what each key and tap does, through the terminal shell's App
// (crates/gp-tui/src/app.rs); this draws it with GTK's own widgets and paints slides from the core's layout.
mod faces;
mod image_items;
mod item_menu;
mod keys;
mod layout;
mod look;
mod model;
mod output;
mod painter;
mod presentation;
mod presentation_menu;
mod shell;
mod start_page;
mod ticking;
mod tiles;

use adw::prelude::*;
use std::path::PathBuf;

/// The organisation's database: the first argument, else GP_DB, else the demo's beside the working directory.
pub fn db_path() -> PathBuf {
    std::env::args().nth(1).or_else(|| std::env::var("GP_DB").ok()).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("demo.sqlite"))
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
