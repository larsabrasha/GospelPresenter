// A presentation's details dialog as one reducer every shell runs (Lars, 2026-11-22: a form with a state of its own is
// the core's): Redigera detaljer, Skapa presentation, and Skapa from a template (the web's PresentationDetailsDialog,
// DetailsDialog and CreatePresentationDialog; the Mac's DetailsSheet). The shell draws the fields and sends what
// happens in them; the core keeps them, cuts each to its length, says when the confirming button may be pressed, and
// answers the change to run: the fields trimmed, an empty one null, the theme only when it changed. Redigera detaljer
// closes at once (a refused change is said after, by the shell's own means); Skapa waits for its change, then opens
// the presentation made.
use crate::args::*;
use crate::bridge::sql;
use crate::mutators::presentations::{DESCRIPTION, LOCATION};
use crate::view_types::{DetailsAction, DetailsEffect as Do, DetailsEvent, DetailsField as F, DetailsMode, DetailsState, DetailsStep, DetailsView};
use serde_json::{json, Map, Value};

fn text(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

/// A presentation's or a template's row, as the dialog fills from it; none when it is gone.
async fn row(id: &str) -> Option<Value> {
    let r = sql("SELECT name, event_date, time, location, description, theme_id, weekday FROM presentations WHERE id = ? AND deleted_at IS NULL", vec![json!(id)]).await.into_iter().next()?;
    let k = ["name", "eventDate", "time", "location", "description", "themeId", "weekday"];
    Some(Value::Object(k.iter().zip(r).map(|(k, v)| (k.to_string(), v)).collect()))
}

/// The dialog opened: {presentationId} for Redigera detaljer, {templateId, today, now (HH:MM)} for Skapa from a
/// template, else Skapa blank with {defaultName} (the shell's word for it) as the name.
async fn opened(init: &Obj) -> R<DetailsState> {
    if let Some(pid) = opt_id(init, "presentationId")? {
        let p = row(&pid).await.ok_or("not-found")?;
        let theme = text(&p["themeId"]);
        return Ok(DetailsState {
            mode: DetailsMode::Edit, presentation_id: Some(pid), template_id: None, name: text(&p["name"]), event_date: text(&p["eventDate"]),
            time: text(&p["time"]), location: text(&p["location"]), description: text(&p["description"]), theme_id: theme.clone(), initial_theme_id: theme, saving: false,
        });
    }
    if let Some(tid) = opt_id(init, "templateId")? {
        let t = row(&tid).await.ok_or("not-found")?;
        let slot = crate::template_view::view(&json_obj(json!({
            "template": { "weekday": t["weekday"], "time": t["time"], "location": t["location"] },
            "today": init.get("today").cloned().unwrap_or(json!("")), "now": init.get("now").cloned().unwrap_or(json!("00:00")),
        })))?;
        return Ok(DetailsState {
            mode: DetailsMode::Template, presentation_id: None, template_id: Some(tid), name: text(&t["name"]), event_date: text(&slot["nextDate"]),
            time: text(&t["time"]), location: text(&t["location"]), ..DetailsState::default()
        });
    }
    Ok(DetailsState { mode: DetailsMode::Create, name: text(init.get("defaultName").unwrap_or(&Value::Null)), ..DetailsState::default() })
}

fn json_obj(v: Value) -> Obj { v.as_object().cloned().unwrap_or_default() }

/// A field's most characters (the mutators' own limits).
fn max(f: F) -> Option<usize> {
    match f { F::Name => Some(NAME), F::Location => Some(LOCATION), F::Description => Some(DESCRIPTION), _ => None }
}

fn set(st: &mut DetailsState, f: F, value: String) {
    let value = match max(f) { Some(n) => value.chars().take(n).collect(), None => value };
    match f {
        F::Name => st.name = value, F::EventDate => st.event_date = value, F::Time => st.time = value,
        F::Location => st.location = value, F::Description => st.description = value, F::ThemeId => st.theme_id = value,
    }
}

/// The confirming button may be pressed: a name, and nothing being made.
fn can_save(st: &DetailsState) -> bool { !st.name.trim().is_empty() && !st.saving }

/// A text field as the mutators take it: trimmed, an empty one null; a date or a time as typed, empty null.
fn field(v: &str, trim: bool) -> Value {
    let v = if trim { v.trim() } else { v };
    if v.is_empty() { Value::Null } else { json!(v) }
}

/// The change Spara or Skapa runs, and what follows it.
async fn save(st: &mut DetailsState, id: Option<String>, now: i64, out: &mut Vec<Do>) -> R<()> {
    if !can_save(st) { return Ok(()) }
    let mut args = json!({
        "name": st.name.trim(), "eventDate": field(&st.event_date, false), "time": field(&st.time, false),
        "location": field(&st.location, true), "description": field(&st.description, true),
    });
    match st.mode {
        DetailsMode::Edit => {
            args["id"] = json!(st.presentation_id);
            if st.theme_id != st.initial_theme_id { args["themeId"] = field(&st.theme_id, false) }
            out.push(Do::Run { command: "updatePresentation".into(), args });
            out.push(Do::Close);
        }
        DetailsMode::Create | DetailsMode::Template => {
            let Some(id) = id.filter(|i| !i.is_empty()) else { return Err("invalid-args".into()) };
            args["id"] = json!(id);
            st.presentation_id = Some(id.clone());
            let command = if let (DetailsMode::Template, Some(tid)) = (st.mode, &st.template_id) {
                // The template's items as they are now, each copy with an id of its own, made from the new one's.
                let items = crate::lists::items(&json_obj(json!({ "presentationId": tid }))).await?;
                let copies: Vec<Value> = items.as_array().into_iter().flatten().enumerate()
                    .map(|(n, item)| json!({ "from": item["id"], "id": format!("{id}-{n}") })).collect();
                (args["templateId"], args["items"], args["at"]) = (json!(tid), json!(copies), json!(now));
                "createFromTemplate"
            } else { "createPresentation" };
            st.saving = true;
            out.push(Do::Run { command: command.into(), args });
        }
    }
    Ok(())
}

/// What the dialog shows (the web's and the native ones' alike): the title, the fields in their groups (the theme
/// only for one there), the buttons, the fields' lengths.
fn view_of(st: &DetailsState) -> DetailsView {
    let new = st.mode != DetailsMode::Edit;
    let mut groups = vec![vec![F::Name, F::Location], vec![F::EventDate, F::Time]];
    if !new { groups.push(vec![F::ThemeId]) }
    groups.push(vec![F::Description]);
    let button = |id: &str, text: &str, role: &str, busy: Option<&str>, enabled: bool| DetailsAction {
        id: id.into(), text: text.into(), role: role.into(), busy_text: busy.map(String::from), enabled,
    };
    DetailsView {
        title: if new { "presentations.createTitle" } else { "presentation.editDetails" }.into(),
        groups,
        actions: vec![
            button("cancel", "common.cancel", "cancel", None, true),
            button("save", if new { "common.create" } else { "common.save" }, "confirm", new.then_some("common.creating"), can_save(st)),
        ],
        name_max: NAME as i64, location_max: LOCATION as i64, description_max: DESCRIPTION as i64,
    }
}

/// `detailsStepView` {state, event, now} (or {init} first, see `opened`): the state after the event, what the dialog
/// shows, and what the shell does, in order (`DetailsStep`; the events `DetailsEvent` and the effects `DetailsEffect`
/// of view_types.rs). `now` (ms) is the time a template was last used.
pub async fn view(a: &Obj) -> R<Value> {
    let mut st: DetailsState = match a.get("state") {
        Some(v) if v.is_object() => serde_json::from_value(v.clone()).map_err(|_| "invalid-args".to_string())?,
        _ => opened(a.get("init").and_then(Value::as_object).unwrap_or(&Map::new())).await?,
    };
    let mut out = vec![];
    if let Some(raw) = a.get("event") {
        let now = a.get("now").and_then(Value::as_i64).unwrap_or(0);
        match serde_json::from_value::<DetailsEvent>(raw.clone()).map_err(|_| "invalid-args".to_string())? {
            DetailsEvent::Set { field, value } => set(&mut st, field, value),
            DetailsEvent::Enter { field: F::Name, id } => save(&mut st, id, now, &mut out).await?,
            DetailsEvent::Enter { .. } => {}
            DetailsEvent::Save { id } => save(&mut st, id, now, &mut out).await?,
            DetailsEvent::Cancel => out.push(Do::Close),
            DetailsEvent::Done { ok } => {
                if st.saving && ok {
                    out.push(Do::Close);
                    if let Some(pid) = st.presentation_id.clone() { out.push(Do::Open { presentation_id: pid }) }
                }
                st.saving = false;
            }
        }
    }
    let view = view_of(&st);
    serde_json::to_value(DetailsStep { state: st, view, effects: out }).map_err(|e| e.to_string())
}
