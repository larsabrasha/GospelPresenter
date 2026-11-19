mod args;
mod bible;
mod bible_books;
mod bible_import;
mod bible_view;
mod bridge;
mod collation;
mod files;
mod item_views;
mod json;
mod legacy;
mod live;
mod live_state;
mod lists;
mod live_views;
mod media_views;
mod mutators;
mod page_models;
mod page_state;
mod ordered;
mod pages;
mod presentation_page;
mod presenting;
mod propresenter;
mod rows;
mod schema;
mod search;
mod settings_views;
#[cfg(feature = "layout")]
mod slide_layout;
#[cfg(feature = "layout")]
mod slide_items;
mod slides;
mod song_import;
mod song_page;
mod song_views;
mod sync;
mod sync_sql;
mod theme_def;
mod themes;
mod views;

/// What a native shell calls (crates/gp-core-ffi): a command or a view started, and each statement's rows given back.
pub use bridge::{resume, start, Rows, Step};
#[cfg(feature = "layout")]
pub use slide_layout::{add_face as add_slide_face, shipped_face as slide_face};
