// The app's live state (ADR 0007, decision 4; docs/view-models.md): the pointer every window of a device shares, which
// presentation is presented, its slide, black, the overlay shown. It changes only here, so every shell holds the same
// rules: one presentation presented at a time, and the overlays' (packages/core/src/live.ts at 238d481b:
// applyLiveChange, followItemOverlay). Which of two pointers is newer (`rev`) stays the channel's between windows.
use crate::args::*;
use serde_json::{json, Map, Value};

const FIELDS: [&str; 5] = ["presentationId", "itemId", "partIndex", "black", "overlayId"];

/// JavaScript's truthiness of an id: a string that is not empty.
fn some(v: &Value) -> bool { v.as_str().is_some_and(|s| !s.is_empty()) }

/// `liveChangeView` {pointer, change, overlays}: the pointer after `change`, numbered one after it (`rev`), with the
/// overlay rules of `applyLiveChange`; `overlays` names the overlay each item carries (an item's id to its overlay's or
/// null). A change that would start a presentation while another is presented is refused, `another-presented`: the
/// one presented is ended first (Lars, 2026-11-18). {pointer} or {refused}.
///
/// The overlay rules: a change that names `overlayId` is a manual toggle, which sets it, and showing one ends the
/// black screen (LIVE-R11); black and stopping switch it off; a slide shown again after black switches on the overlay
/// its item carries; moving to another item switches off the overlay the item left carries, if that is still the one
/// shown, and switches on the one the new item carries, a manual choice staying until the item changes and after it
/// when it was not the left item's own (LIVE-R15, R16).
pub fn change(a: &Obj) -> R<Value> {
    let prev = obj(a.get("pointer").ok_or("invalid-args")?)?;
    let change = obj(a.get("change").ok_or("invalid-args")?)?;
    let overlays = a.get("overlays").and_then(Value::as_object).cloned().unwrap_or_default();
    let overlay_of = |item: &Value| -> Value { if some(item) { overlays.get(item.as_str().unwrap()).cloned().unwrap_or(Value::Null) } else { Value::Null } };
    let was = |k: &str| prev.get(k).cloned().unwrap_or(Value::Null);
    if let Some(to) = change.get("presentationId") {
        if some(to) && some(&was("presentationId")) && *to != was("presentationId") { return Ok(json!({ "refused": "another-presented" })) }
    }
    let mut next = Map::new();
    for k in FIELDS { next.insert(k.into(), change.get(k).cloned().unwrap_or_else(|| was(k))); }
    let rev = prev.get("rev").and_then(Value::as_f64).unwrap_or(0.0) + 1.0;
    let done = |mut next: Map<String, Value>| {
        next.insert("rev".into(), if rev.fract() == 0.0 { json!(rev as i64) } else { json!(rev) });
        Ok(json!({ "pointer": next }))
    };
    if let Some(o) = change.get("overlayId") {
        if some(o) { next.insert("black".into(), json!(false)); }
        return done(next);
    }
    if !some(&next["presentationId"]) || next["black"] == json!(true) {
        next.insert("overlayId".into(), Value::Null);
        return done(next);
    }
    if was("black") == json!(true) {
        let on = overlay_of(&next["itemId"]);
        next.insert("overlayId".into(), on);
        return done(next);
    }
    if next["itemId"] == was("itemId") { return done(next) }
    let left = overlay_of(&was("itemId"));
    let entered = overlay_of(&next["itemId"]);
    let kept = if some(&left) && was("overlayId") == left { Value::Null } else { was("overlayId") };
    next.insert("overlayId".into(), if entered.is_null() { kept } else { entered });
    done(next)
}

/// `followItemOverlayView` {pointer, before?, after?}: the overlay to show when the shown item's own overlay is
/// changed while it is presented (Lars, 2026-11-02: at once), `followItemOverlay`: the new one, if the outputs show the
/// item's old one; else nothing to change, as when black, nothing shown, the old one not known (`before` left out) or
/// a manual choice standing. {change: false} or {change: true, overlayId}.
pub fn follow_item_overlay(a: &Obj) -> R<Value> {
    let p = obj(a.get("pointer").ok_or("invalid-args")?)?;
    let (before, after) = (a.get("before"), a.get("after"));
    let none = json!({ "change": false });
    if !some(p.get("presentationId").unwrap_or(&Value::Null)) || !some(p.get("itemId").unwrap_or(&Value::Null)) || p.get("black") == Some(&json!(true)) { return Ok(none) }
    let Some(before) = before else { return Ok(none) };
    if Some(before) == after { return Ok(none) }
    if p.get("overlayId").unwrap_or(&Value::Null) != before { return Ok(none) }
    Ok(json!({ "change": true, "overlayId": after.cloned().unwrap_or(Value::Null) }))
}
