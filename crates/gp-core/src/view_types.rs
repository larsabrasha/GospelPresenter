// The views' answers as types (Lars, 2026-11-22: typed view models, so no shell decodes JSON by hand). Each is the
// JSON a view answers, field for field; with the `schema` feature their JSON Schema is written (examples/schema.rs),
// and the shells' types are generated from it (apps/mac's ViewTypes.swift, the web's and Windows' in time). The Rust
// shells (gp-tui, Linux) use these types themselves.
use serde::{Deserialize, Serialize};

#[cfg(any(test, feature = "schema"))]
use schemars::JsonSchema;

/// A part of a date line (`dateLineView`): one of the app's texts by key (Idag, Imorgon, LIVE), or a text as it is.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
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
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
pub struct DateLine { pub parts: Vec<LinePart> }

/// A presentation as the start page lists it (`Presentation` of packages/core, with its number of items and its line).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
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
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct StartList {
    pub id: String,
    pub title: String,
    pub show_date: bool,
    pub with_year: bool,
    pub rows: Vec<PresentationRow>,
}

/// What happened to a device's live socket (`liveStepView`'s `event`), as the shell tells it. Its time is `now` beside
/// it (ms), at the top or in the event.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LiveEvent {
    /// Signed in: the socket wanted.
    Start,
    /// Signed out: the socket closed, not opened again.
    Stop,
    /// The socket opened (its first send went out).
    SocketOpened,
    /// The socket closed or could not open.
    SocketClosed,
    /// A message the server sent, as it came.
    Message { message: serde_json::Value },
    /// A timer the core set ran out.
    Timer { name: String },
    /// The app's live state changed; null when nothing is presented.
    Follow { pointer: serde_json::Value },
    /// Tillåt fjärrstyrning switched.
    Remote { on: bool },
    /// An output switched, taking it over from another presentation (asked first) with `take`.
    Output { id: String, on: bool, #[serde(default)] take: bool },
    /// What the app's player plays, for controllers to mirror, and the video's place for the outputs.
    Playback { audio: serde_json::Value, video: serde_json::Value, video_live: serde_json::Value },
    /// The data changed: what the outputs show is reported again.
    Changed,
    /// Ta kontroll: the session elsewhere driven from here.
    Control { session_id: String },
    /// Driving a session elsewhere ended.
    Release,
    /// A change of the page sent to the session driven from here.
    Set { change: serde_json::Value },
}

/// What the shell does after a `liveStepView` step, in order.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LiveEffect {
    /// Open the socket (`/api/live/socket`, the credentials as subprotocols); its first send gone, tell `socketOpened`.
    OpenSocket,
    /// Close it, and tell `socketClosed`.
    CloseSocket,
    /// Send this message as JSON text.
    Send { message: serde_json::Value },
    /// After `ms`, tell `timer` with this name; one of the same name set before is replaced.
    Timer { name: String, ms: i64 },
    /// A controller's command taken: change this device's live state by it, as a change of its own.
    Apply { change: serde_json::Value },
    /// A controller's audio command for what this device plays.
    Audio { command: serde_json::Value },
    /// A controller's video command for what this device plays.
    Video { command: serde_json::Value },
    /// Show the session driven from here at this live state.
    Mirror { pointer: serde_json::Value },
    /// The session driven from here is gone: stop driving it.
    Lost,
    /// A command was not confirmed in 2 s: say so, once.
    Unconfirmed,
}

/// The session driven from here.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LiveControl {
    /// Its id.
    pub session_id: String,
    /// The command sent and not yet echoed.
    pub pending: serde_json::Value,
    /// "Not confirmed" was said.
    pub warned: bool,
}

/// A device's live socket as the core keeps it between steps; the shell gives it back whole, and reads what it shows.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    /// This device's session.
    pub session_id: String,
    /// Its name as members see it.
    pub device_name: String,
    /// Signed in: the socket wanted.
    pub started: bool,
    /// The socket is open.
    pub connected: bool,
    /// Failed tries since it was last open.
    pub attempt: i64,
    /// When the socket last heard anything (ms).
    pub heard: i64,
    /// A ping is out.
    pub pinged: bool,
    /// The report last sent: only a new one goes.
    pub last_sent: String,
    /// Tillåt fjärrstyrning.
    pub remote: bool,
    /// The outputs this session sends to.
    pub chosen: Vec<String>,
    /// Outputs taken over from another presentation, until the server lists them as this one's.
    pub take_over: Vec<String>,
    /// The screens seen online or paired (one gone after is switched off).
    pub seen: Vec<String>,
    /// What this device presents (the live state), null when nothing.
    pub pointer: serde_json::Value,
    /// What its player plays, for controllers to mirror.
    pub audio: serde_json::Value,
    pub video: serde_json::Value,
    /// The video's place, for the outputs.
    pub video_live: serde_json::Value,
    /// The organisation's sessions (`LiveSessionInfo`).
    pub sessions: Vec<serde_json::Value>,
    /// The outputs with a page open.
    pub online: Vec<String>,
    /// The temporary screens paired with the organisation.
    pub screens: Vec<serde_json::Value>,
    /// The sessions a member may drive (Ta kontroll).
    pub controllable: Vec<serde_json::Value>,
    /// The session driven from here, while one is.
    pub control: Option<LiveControl>,
}

/// `liveStepView`'s answer: the state to give back, and what to do, in order.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
pub struct LiveStep { pub state: LiveState, pub effects: Vec<LiveEffect> }

/// What a presentation's details dialog is for.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum DetailsMode {
    /// Redigera detaljer of a presentation there.
    #[default]
    Edit,
    /// Skapa presentation, blank.
    Create,
    /// Skapa presentation from a template: its name, next date, time and place prefilled, its items copied.
    Template,
}

/// A field of the details dialog, by the name its mutators take.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum DetailsField {
    /// The presentation's name.
    Name,
    /// Its date, `YYYY-MM-DD`, empty for none.
    EventDate,
    /// Its time, `HH:MM`, empty for none.
    Time,
    /// Where it is.
    Location,
    /// What it is about.
    Description,
    /// Its theme's id, empty for the default.
    ThemeId,
}

/// The details dialog as the core keeps it between steps: each field as typed, empty for cleared.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DetailsState {
    /// What the dialog is for.
    pub mode: DetailsMode,
    /// The presentation edited (Redigera detaljer).
    pub presentation_id: Option<String>,
    /// The template a new one is made from.
    pub template_id: Option<String>,
    /// The name.
    pub name: String,
    /// The date, `YYYY-MM-DD`, empty for none.
    pub event_date: String,
    /// The time, `HH:MM`, empty for none.
    pub time: String,
    /// The place.
    pub location: String,
    /// The description.
    pub description: String,
    /// The theme's id, empty for the default.
    pub theme_id: String,
    /// The theme it had: only a theme changed is sent, so a shell without the theme's field never clears it.
    pub initial_theme_id: String,
    /// A new one is being made: the button says so, and nothing is sent twice.
    pub saving: bool,
}

/// What happened in the details dialog.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DetailsEvent {
    /// A field typed in or chosen: kept, cut to its most characters.
    Set { field: DetailsField, value: String },
    /// ↵ in a field: in the name it saves, as the confirming button (`id` as Save's).
    Enter { field: DetailsField, #[serde(default)] id: Option<String> },
    /// The confirming button (Spara, Skapa). `id`: a new id from the shell, for a presentation made.
    Save { id: Option<String> },
    /// Avbryt, ✕ or Esc: closed, nothing sent.
    Cancel,
    /// The change the step asked for ran: `ok`, or refused (the dialog stays, for another try).
    Done { ok: bool },
}

/// What the shell does after a details step, in order.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DetailsEffect {
    /// Run this change (a mutator and its arguments), then tell `done` how it went.
    Run { command: String, args: serde_json::Value },
    /// Close the dialog.
    Close,
    /// Open this presentation's page (one just made).
    Open { presentation_id: String },
}

/// A button of the dialog: its id, its text's key, its role (cancel or confirm), its text's key while it works.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DetailsAction {
    /// What it is: cancel or save.
    pub id: String,
    /// Its text's key.
    pub text: String,
    /// Its role: cancel or confirm.
    pub role: String,
    /// Its text's key while it works, where it says so.
    pub busy_text: Option<String>,
    /// Whether it may be pressed now.
    pub enabled: bool,
}

/// What the details dialog shows: its title's key, its fields in their groups, its buttons, and each field's most
/// characters.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DetailsView {
    /// The title's key.
    pub title: String,
    /// The fields in their groups, in order.
    pub groups: Vec<Vec<DetailsField>>,
    /// The buttons, Avbryt then the confirming one.
    pub actions: Vec<DetailsAction>,
    /// The name's most characters.
    pub name_max: i64,
    /// The place's most characters.
    pub location_max: i64,
    /// The description's most characters.
    pub description_max: i64,
}

/// `detailsStepView`'s answer: the state to give back, what the dialog shows, and what to do.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(any(test, feature = "schema"), derive(JsonSchema))]
pub struct DetailsStep { pub state: DetailsState, pub view: DetailsView, pub effects: Vec<DetailsEffect> }

/// Every type a shell reads, in one JSON Schema (schema/views.json; its `$defs` are the types).
#[cfg(any(test, feature = "schema"))]
pub fn schema() -> serde_json::Value {
    #[derive(JsonSchema)]
    #[allow(dead_code)]
    struct Views { start_page: Vec<StartList>, date_line: DateLine, live_step: LiveStep, live_event: LiveEvent, details_step: DetailsStep, details_event: DetailsEvent }
    serde_json::to_value(schemars::schema_for!(Views)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_schema_checked_in_follows_the_types() {
        let file = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/schema/views.json")).unwrap_or_default();
        let checked_in: serde_json::Value = serde_json::from_str(&file).unwrap_or_default();

        assert!(checked_in == super::schema(), "schema/views.json is not the types' schema: run crates/gp-core/schema/generate.sh");
    }
}
