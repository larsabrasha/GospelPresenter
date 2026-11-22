// A field saved as it is typed, as one reducer every shell runs (Lars, 2026-11-22: a form's state and its edge cases
// are the core's): the web's AutoSaveField, Debounced and SaveBaseline. Written half a second after the last key and
// at once when it loses the focus; nothing written when it is typed back to what is stored or was last written; a
// blank name or a year that is not one never written, the stored value shown again once the field is left; the stored
// value followed whenever the user is not typing; and with `warnOnClash` (a song part's text, D18), another device's
// change while the user types stops the writing and asks: keep theirs (written at once) or take the other.
use crate::args::*;
use crate::view_types::{AutoSaveEffect as Do, AutoSaveEvent as E, AutoSaveKind, AutoSaveState, AutoSaveStep};
use serde_json::{json, Map, Value};

/// The half second after the last key.
const DELAY_MS: i64 = 500;

/// The field opened: {command, args, field, kind?, max?, warnOnClash?, stored}.
fn opened(init: &Obj) -> R<AutoSaveState> {
    let text = |k: &str| init.get(k).and_then(Value::as_str).map(String::from);
    Ok(AutoSaveState {
        command: text("command").ok_or("invalid-args")?,
        args: init.get("args").cloned().unwrap_or(json!({})),
        field: text("field").ok_or("invalid-args")?,
        kind: init.get("kind").cloned().map(serde_json::from_value).transpose().map_err(|_| "invalid-args".to_string())?.unwrap_or_default(),
        max: init.get("max").and_then(Value::as_i64).unwrap_or(i64::MAX),
        warn_on_clash: init.get("warnOnClash").and_then(Value::as_bool).unwrap_or(false),
        stored: text("stored").unwrap_or_default(),
        ..AutoSaveState::default()
    })
}

/// A value as its field writes it, or none when it is not to be written.
fn written(kind: AutoSaveKind, v: &str) -> Option<Value> {
    match kind {
        AutoSaveKind::Text => Some(json!(v)),
        AutoSaveKind::Required => (!v.trim().is_empty()).then(|| json!(v)),
        AutoSaveKind::Year => match v.trim() {
            "" => Some(Value::Null),
            y => y.parse::<i64>().ok().filter(|n| (0..=9999).contains(n)).map(|n| json!(n)),
        },
    }
}

struct Step { st: AutoSaveState, out: Vec<Do> }

impl Step {
    fn shown(&self) -> String { self.st.draft.clone().unwrap_or_else(|| self.st.stored.clone()) }

    /// What waits is written now, if it is a change and may be written.
    fn flush(&mut self) {
        let Some(v) = self.st.pending.take() else { return };
        self.out.push(Do::CancelTimer);
        // Typed back to what is stored, or to the last write while the stored value has not moved since: nothing.
        let same = match (&self.st.last_written, &self.st.last_over) {
            (Some(w), Some(over)) if *over == self.st.stored => v == *w,
            _ => v == self.st.stored,
        };
        if same { self.st.refused = false; return }
        let Some(value) = written(self.st.kind, &v) else { self.st.refused = true; return };
        self.st.refused = false;
        (self.st.last_written, self.st.last_over) = (Some(v.clone()), Some(self.st.stored.clone()));
        if !self.st.own.contains(&v) { self.st.own.push(v) }
        let mut args = self.st.args.clone();
        if !args.is_object() { args = json!({}) }
        args[&self.st.field] = value;
        self.out.push(Do::Run { command: self.st.command.clone(), args });
    }

    fn event(&mut self, e: E) {
        match e {
            E::Focus => {
                self.st.focused = true;
                self.st.draft = Some(self.shown());
                if self.st.clash.is_none() { self.st.own.clear(); self.st.typed = false }
            }
            E::Input { value } => {
                let value: String = value.chars().take(self.st.max.max(0) as usize).collect();
                self.st.draft = Some(value.clone());
                self.st.typed = true;
                if self.st.clash.is_none() {
                    self.st.pending = Some(value);
                    self.out.push(Do::Timer { ms: DELAY_MS });
                }
            }
            E::Timer => self.flush(),
            E::Blur => {
                self.st.focused = false;
                self.flush();
                if self.st.refused && self.st.clash.is_none() { self.st.draft = None }
            }
            E::Stored { value } => {
                if value == self.st.stored { return }
                self.st.stored = value.clone();
                let draft = self.st.draft.clone();
                let typing = self.st.focused || self.st.pending.is_some() || self.st.clash.is_some();
                if self.st.warn_on_clash && !self.st.own.contains(&value) && typing && self.st.typed && draft.is_some_and(|d| d != value) {
                    // Changed elsewhere while the user types here: nothing more is written until they choose.
                    self.st.pending = None;
                    self.out.push(Do::CancelTimer);
                    self.st.clash = Some(value);
                } else if !self.st.focused && self.st.pending.is_none() && self.st.clash.is_none() {
                    self.st.draft = None;
                }
            }
            E::Done { ok } => {
                if ok { self.out.push(Do::Saved) } else {
                    // Refused: the same value is written again rather than taken as stored.
                    (self.st.last_written, self.st.last_over) = (None, None);
                    self.out.push(Do::Failed);
                }
            }
            E::KeepMine => {
                self.st.clash = None;
                self.st.pending = Some(self.shown());
                self.flush();
            }
            E::TakeTheirs => {
                self.st.clash = None;
                self.st.typed = false;
                self.st.draft = if self.st.focused { Some(self.st.stored.clone()) } else { None };
            }
        }
    }
}

/// `autoSaveStepView` {state, event} (or {init} first, see `opened`): the field after the event, its text and its
/// clash, and what the shell does, in order (`AutoSaveStep`; `AutoSaveEvent` and `AutoSaveEffect` of view_types.rs).
pub fn view(a: &Obj) -> R<Value> {
    let st = match a.get("state") {
        Some(v) if v.is_object() => serde_json::from_value(v.clone()).map_err(|_| "invalid-args".to_string())?,
        _ => opened(a.get("init").and_then(Value::as_object).unwrap_or(&Map::new()))?,
    };
    let mut s = Step { st, out: vec![] };
    if let Some(raw) = a.get("event") {
        s.event(serde_json::from_value::<E>(raw.clone()).map_err(|_| "invalid-args".to_string())?);
    }
    let (shown, clash) = (s.shown(), s.st.clash.clone());
    serde_json::to_value(AutoSaveStep { state: s.st, shown, clash, effects: s.out }).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "autosave_tests.rs"]
mod tests;
