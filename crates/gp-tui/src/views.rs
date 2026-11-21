// The core's views as this shell reads them (crates/gp-core/src/views.rs), decoded: the start page (`startPageView`),
// a presentation's page (`presentationPageView`), the app's live state (`liveChangeView`), a page's own state
// (`pageEventView`) and the marks VISAS and NÄSTA (`slideMarksView`). Only the fields this shell shows are decoded;
// apps/mac/Sources/GPMac/Views.swift is the same for Swift.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// A presentation as a list shows it, with its number of items where the view gives it.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationRow {
    pub id: String,
    pub name: String,
    pub event_date: Option<String>,
    pub time: Option<String>,
    pub location: Option<String>,
    #[serde(default)]
    pub is_template: bool,
    pub item_count: Option<i64>,
}

/// One of the start page's lists as the core groups them: Idag, Kommande or Senast ändrade, in their order, an empty
/// one left out; its title a text's key; whether its rows show their date and its year.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartList {
    pub id: String,
    pub title: String,
    pub show_date: bool,
    pub with_year: bool,
    pub rows: Vec<PresentationRow>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct SlideLabel {
    pub text: String,
    pub color: String,
}

/// A slide as `readItemSlides` gives it: its text (empty for a picture or a video), its label, its kind.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Slide {
    pub key: String,
    pub kind: String,
    #[serde(default)]
    pub text: String,
    pub label: Option<SlideLabel>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageItem {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub title: String,
    pub overlay_id: Option<String>,
}

#[derive(Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ItemSlides {
    #[serde(default)]
    pub slides: Vec<Slide>,
    pub problem: Option<String>,
}

/// `presentationPageView`: the presentation, its items in order, and each item's slides by its id.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct PresentationPage {
    pub presentation: Option<PresentationRow>,
    pub items: Vec<PageItem>,
    #[serde(default)]
    pub slides: HashMap<String, ItemSlides>,
}

impl PresentationPage {
    /// The item's slides; none for a heading.
    pub fn slides_of(&self, item: &str) -> &[Slide] { self.slides.get(item).map_or(&[], |s| s.slides.as_slice()) }

    /// Why the item has no slides, if the core says (a song in the trash, a file gone).
    pub fn problem_of(&self, item: &str) -> Option<&str> { self.slides.get(item).and_then(|s| s.problem.as_deref()) }

    /// The running order as the core takes it: each item's id and how many slides it has.
    pub fn order(&self) -> Value {
        Value::Array(self.items.iter().map(|i| serde_json::json!([i.id, self.slides_of(&i.id).len()])).collect())
    }

    /// The overlay each item carries, by the item's id, for the overlays' rules.
    pub fn overlays(&self) -> Value {
        Value::Object(self.items.iter().map(|i| (i.id.clone(), serde_json::json!(i.overlay_id))).collect())
    }

    pub fn item(&self, id: &str) -> Option<&PageItem> { self.items.iter().find(|i| i.id == id) }

    /// The slide at `at`, if the item has it.
    pub fn slide(&self, at: &SlideAt) -> Option<&Slide> { self.slides_of(&at.item_id).get(at.part_index as usize) }
}

/// A slide: its item, and its place among the item's slides.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlideAt {
    pub item_id: String,
    pub part_index: i64,
}

/// The app's live state (`liveChangeView`): the presentation presented, its slide (no item before the first is
/// shown), black (Släck), the overlay, numbered.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LivePointer {
    pub presentation_id: Option<String>,
    pub item_id: Option<String>,
    #[serde(default)]
    pub part_index: i64,
    #[serde(default)]
    pub black: bool,
    pub overlay_id: Option<String>,
    #[serde(default)]
    pub rev: i64,
}

/// A presentation page's own state (`pageEventView`): the item selected, the slide made ready (↵ shows it), the last
/// thing added, a number typed; `presenting` and `followed` are what the core last saw of the live state.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PageState {
    pub selected_id: Option<String>,
    pub picked: Option<SlideAt>,
    pub last_added_id: Option<String>,
    #[serde(default)]
    pub typed: String,
    #[serde(default)]
    pub presenting: bool,
    pub followed: Option<String>,
}

/// The core's answer to one step of a page (`pageStepView`): its state, the live state after it (unchanged where
/// `refused`), what the page does, whether the event was the page's, the marks on the presented page, whether ▶ may
/// start, and the cue over the live picture (a text's key, the slide's number, its item).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageStep {
    pub state: PageState,
    pub live: LivePointer,
    pub refused: Option<String>,
    pub command: Value,
    pub handled: bool,
    pub marks: Option<SlideMarks>,
    pub can_start: bool,
    pub cue: Option<Cue>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub text: String,
    pub n: i64,
    pub item_id: String,
}

/// `slideMarksView`: the slide marked VISAS and the one marked NÄSTA.
#[derive(Deserialize, Clone, Debug, PartialEq, Default)]
pub struct SlideMarks {
    pub shown: Option<MarkAt>,
    pub next: Option<MarkAt>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkAt {
    pub item_id: Option<String>,
    pub part_index: i64,
}

impl MarkAt {
    /// The slide marked, when the mark names one.
    pub fn at(&self) -> Option<SlideAt> { self.item_id.clone().map(|item_id| SlideAt { item_id, part_index: self.part_index }) }
}
