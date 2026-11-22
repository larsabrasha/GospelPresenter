// Remote control's rules (spec 04 §2, ADR 0004; Lars, 2026-11-22: every platform drives a session elsewhere and is
// driven), the same in every shell: the command a controller sends for a change of the page, what it shows of the
// session until the owner's echo, and whether the owner takes a command. The socket, the server's relay and the 2 s
// wait are the shell's (apps/web/src/live/remote.ts, owner.ts); the change itself is the owner's `liveChangeView`.
use crate::args::*;
use serde_json::{json, Map, Value};

/// JavaScript's truthiness of an id: a string that is not empty.
fn some(v: Option<&Value>) -> bool { v.and_then(Value::as_str).is_some_and(|s| !s.is_empty()) }

fn field(o: &Map<String, Value>, k: &str, or: Value) -> Value { o.get(k).filter(|v| !v.is_null()).cloned().unwrap_or(or) }

/// `remoteCommandView` {pointer, change}: the command a controller sends for `change` (a page's, `pageStepView` with
/// `remote`), absolute, so a command lost or repeated leaves the session where it says: {command: {itemId, partIndex,
/// black, overlayId?}}. What the change leaves out is the session's as the controller shows it (`pointer`); an item
/// set to null is none. Only a toggle names the overlay, as the owner applies an item's own; showing one ends black.
pub fn command(a: &Obj) -> R<Value> {
    let now = obj(a.get("pointer").ok_or("invalid-args")?)?;
    let change = obj(a.get("change").ok_or("invalid-args")?)?;
    let item = match change.get("itemId") { Some(v) => v.clone(), None => now.get("itemId").cloned().unwrap_or(Value::Null) };
    let mut out = json!({
        "itemId": item,
        "partIndex": field(change, "partIndex", field(now, "partIndex", json!(0))),
        "black": field(change, "black", field(now, "black", json!(false))),
    });
    if let Some(o) = change.get("overlayId") {
        out["overlayId"] = o.clone();
        if some(Some(o)) { out["black"] = json!(false); }
    }
    Ok(json!({ "command": out }))
}

/// Whether a report shows what a command asked for; the overlay counts only when the command named one.
fn matches(p: &Map<String, Value>, c: &Map<String, Value>) -> bool {
    let at = |o: &Map<String, Value>, k: &str, or: Value| field(o, k, or);
    at(p, "itemId", Value::Null) == at(c, "itemId", Value::Null)
        && at(p, "partIndex", json!(0)).as_f64() == at(c, "partIndex", json!(0)).as_f64()
        && at(p, "black", json!(false)) == at(c, "black", json!(false))
        && (!c.contains_key("overlayId") || at(p, "overlayId", Value::Null) == at(c, "overlayId", Value::Null))
}

/// `remotePointerView` {session, pending}: what a controller shows of a session elsewhere, `session` as the server last
/// listed it ({presentationId, pointer}, null when it is gone) and `pending` the command sent last and not yet
/// echoed. A click shows at once, until the owner's report shows it (optimistic): {pointer (the live state as the
/// page reads it), confirmed (the report shows the pending command: the controller forgets it; else, after 2 s, it
/// warns once)}.
pub fn pointer(a: &Obj) -> R<Value> {
    let session = a.get("session").and_then(Value::as_object);
    let none = Map::new();
    let reported = session.and_then(|s| s.get("pointer")).and_then(Value::as_object).unwrap_or(&none);
    let pending = a.get("pending").and_then(Value::as_object);
    let confirmed = matches!((session, pending), (Some(_), Some(c)) if matches(reported, c));
    let mut shown = reported.clone();
    if let Some(c) = pending.filter(|c| !matches(reported, c)) {
        for (k, v) in c { shown.insert(k.clone(), v.clone()); }
    }
    let pointer = json!({
        "presentationId": session.map_or(Value::Null, |s| field(s, "presentationId", Value::Null)),
        "itemId": field(&shown, "itemId", Value::Null),
        "partIndex": field(&shown, "partIndex", json!(0)),
        "black": field(&shown, "black", json!(false)),
        "overlayId": field(&shown, "overlayId", Value::Null),
        "rev": field(reported, "rev", json!(0)),
    });
    Ok(json!({ "pointer": pointer, "confirmed": confirmed }))
}

/// `remoteTakeView` {pointer, command, item, overlay}: whether the owner applies a controller's command to its own
/// live state, `pointer` (LIVE-R49): only while it presents, only when the item and the overlay named are still there
/// (`item`, `overlay`: the shell has looked them up; true where none is named), and not when it shows that already.
/// {take}; the owner then changes its live state with `liveChangeView` and the command as the change.
pub fn take(a: &Obj) -> R<Value> {
    let p = obj(a.get("pointer").ok_or("invalid-args")?)?;
    let c = obj(a.get("command").ok_or("invalid-args")?)?;
    let there = |k: &str| a.get(k).and_then(Value::as_bool).unwrap_or(true);
    let take = some(p.get("presentationId")) && there("item") && there("overlay") && !matches(p, c);
    Ok(json!({ "take": take }))
}

#[cfg(test)]
#[path = "remote_control_tests.rs"]
mod tests;
