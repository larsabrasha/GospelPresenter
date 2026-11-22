// The views' answers as types (Lars, 2026-11-22: typed view models, so no shell decodes JSON by hand). Each is the
// JSON a view answers, field for field; with the `schema` feature their JSON Schema is written (examples/schema.rs),
// and the shells' types are generated from it (apps/mac's ViewTypes.swift, the web's and Windows' in time). The Rust
// shells (gp-tui, Linux) use these types themselves.
use serde::{Deserialize, Serialize};

#[cfg(feature = "schema")]
use schemars::JsonSchema;

/// A part of a date line (`dateLineView`): one of the app's texts by key (Idag, Imorgon, LIVE), or a text as it is.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "schema", derive(JsonSchema))]
pub struct LinePart {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// What it is: live, date, time or place.
    pub of: String,
}

/// `dateLineView`'s answer.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "schema", derive(JsonSchema))]
pub struct DateLine { pub parts: Vec<LinePart> }

/// A presentation as the start page lists it (`Presentation` of packages/core, with its number of items and its line).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "schema", derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct PresentationRow {
    pub id: String,
    pub name: String,
    pub event_date: Option<String>,
    pub deleted_at: Option<i64>,
    pub theme_id: Option<String>,
    pub is_template: bool,
    pub weekday: Option<i64>,
    pub time: Option<String>,
    pub location: Option<String>,
    pub description: Option<String>,
    pub updated_at: Option<i64>,
    pub last_used_at: Option<i64>,
    #[serde(default)]
    pub item_count: i64,
    /// Its date line as its list shows it.
    #[serde(default)]
    pub line: Vec<LinePart>,
}

/// One of the start page's lists (`startPageView`): Idag, Kommande or Senast ändrade, its title a text's key, whether
/// its rows show their date and its year.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "schema", derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct StartList {
    pub id: String,
    pub title: String,
    pub show_date: bool,
    pub with_year: bool,
    pub rows: Vec<PresentationRow>,
}
