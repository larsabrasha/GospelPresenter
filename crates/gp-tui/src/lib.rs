// Gospel Presenter in a terminal (docs/tui.md): the Rust core in-process over an organisation's SQLite, its views
// drawn with ratatui. The core decides what each page shows and what each key does; this shell maps keys to the core's
// events and draws its answers.
pub mod app;
pub mod dates;
pub mod keys;
pub mod panes;
pub mod phone;
pub mod shell;
pub mod start;
pub mod texts;
pub mod ui;
pub mod views;
