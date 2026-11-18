// A presentation page's own state, one per window (docs/view-models.md, Lars 2026-11-18): the item selected, the slide
// made ready (outlined in blue, ↵ shows it), the last thing added and a number being typed, changed only here, by the
// page's events: its keys, a tap, a row chosen, an addition. Every shell holds the state and sends its events; what
// the keys do is the same on each (apps/web/src/pages/presentation-editor/useEditorKeys.ts had it, spec 03 section 6,
// spec 04 "Keyboard shortcuts during live"). What only a screen knows stays the shell's: which slide is above another
// in a grid (it sends `pickAt`), where the focus is (it says whether ↵ is the page's), and how long a number waits.
//
// The app's live state, which presentation is presented and its slide, is not here: it is read (`context.live`), and
// a change to it comes back as `live`, for the shell to apply through `liveChangeView` (live_state.rs).
use crate::args::*;
use serde_json::{json, Map, Value};

struct Page<'a> {
    st: Map<String, Value>,
    presenting: bool,
    live: &'a Obj,
    /// The item on the outputs while this page is presented, black or not.
    live_item: Option<String>,
    counts: Vec<(String, i64)>,
}

fn s_of(v: Option<&Value>) -> Option<String> { v.and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from) }
fn opt(v: &Option<String>) -> Value { v.as_ref().map_or(Value::Null, |s| json!(s)) }

impl Page<'_> {
    fn get(&self, k: &str) -> Option<String> { s_of(self.st.get(k)) }
    fn set(&mut self, k: &str, v: Value) { self.st.insert(k.into(), v); }
    fn picked(&self) -> Option<(String, i64)> {
        let p = self.st.get("picked")?;
        Some((s_of(p.get("itemId"))?, p.get("partIndex")?.as_i64()?))
    }
    fn count(&self, item: &str) -> i64 { self.counts.iter().find(|(i, _)| i == item).map_or(0, |(_, n)| *n) }
    fn typed(&self) -> String { self.get("typed").unwrap_or_default() }

    /// What follows from the context before any event: presenting started or ended lets go of the last thing added and
    /// the slide made ready; another item shown while presenting is the one selected, and lets go of the slide made
    /// ready (a slide stepped into the next item takes the selection along).
    fn sync(&mut self) {
        if self.st.get("presenting").and_then(Value::as_bool).unwrap_or(false) != self.presenting {
            self.set("presenting", json!(self.presenting));
            self.set("lastAddedId", Value::Null);
            self.set("picked", Value::Null);
        }
        if self.presenting && self.get("followed") != self.live_item {
            let item = self.live_item.clone();
            self.set("followed", opt(&item));
            if item.is_some() { self.set("selectedId", opt(&item)) }
            self.set("picked", Value::Null);
        }
    }

    /// A key of presenting as `presentingKeyView` answers it: what is shown changes the app's live state, the slide
    /// made ready takes the selection along.
    fn press(&mut self, order: &Value, key: Value) -> R<Option<Value>> {
        let shown = json!({ "itemId": self.live.get("itemId").cloned().unwrap_or(Value::Null), "partIndex": self.live.get("partIndex").cloned().unwrap_or(json!(0)), "black": self.live.get("black").cloned().unwrap_or(json!(false)) });
        let picked = self.st.get("picked").cloned().unwrap_or(Value::Null);
        let mut args = Map::new();
        args.insert("order".into(), order.clone());
        args.insert("state".into(), json!({ "presenting": self.presenting, "shown": shown, "picked": picked }));
        args.insert("key".into(), key);
        let next = crate::presenting::key(&args)?;
        if next["picked"] != picked {
            if let Some(item) = s_of(next["picked"].get("itemId")) { self.set("selectedId", json!(item)) }
            self.set("picked", next["picked"].clone());
        }
        Ok((next["shown"] != shown).then(|| next["shown"].clone()))
    }
}

fn page<'a>(a: &'a Obj) -> R<(Page<'a>, &'a Value)> {
    let cx = obj(a.get("context").ok_or("invalid-args")?)?;
    let live = obj(cx.get("live").ok_or("invalid-args")?)?;
    let presenting = cx.get("presenting").and_then(Value::as_bool).unwrap_or(false);
    let order = a.get("order").ok_or("invalid-args")?;
    let counts = order.as_array().ok_or("invalid-args")?.iter()
        .filter_map(|r| Some((r.get(0)?.as_str()?.to_string(), r.get(1)?.as_i64()?))).collect();
    let mut p = Page {
        st: a.get("state").and_then(Value::as_object).cloned().unwrap_or_default(),
        presenting, live, live_item: if presenting { s_of(live.get("itemId")) } else { None }, counts,
    };
    p.sync();
    Ok((p, order))
}

/// `pageEventView` {state, context: {presentationId, isTemplate, presenting, live}, order, event}: the page's state after
/// an event, a change to the app's live state if any, the command the shell carries out (a dialog, a mutation, a
/// scroll), and whether the event was the page's (a key that was not leaves the browser its own use of it).
///
/// The events: `pick` {delta} (← →), `clicker` {delta} (PageUp/PageDown: steps while presenting, else picks), `step`
/// {delta} (Space, only while presenting), `black` (b and ., only while presenting), `enter` {onPage} (↵: the slide made
/// ready, or a number typed; else, only where the focus is the page's, the next), `escape` (the number, then the slide
/// made ready), `digit` {digit} (that slide of the item made ready, while presenting), `clearTyped` (the number waited
/// long enough), `item` {delta} (⌘↑ ⌘↓: the item before or after, its first slide made ready), `pickAt` {itemId,
/// partIndex} (↑ ↓ as the slides stand on the screen), `show` {itemId, partIndex} (a slide tapped: shown while
/// presenting, else made ready), `select` {itemId} (a row chosen), `added` {itemId}, `move` {by} (⌥↑ ⌥↓), `delete`,
/// `add`, `start` (F5, ⌥⌘P, ▶), `end` (⌘.), `sync` (the context changed).
pub fn event(a: &Obj) -> R<Value> {
    let (mut p, order) = page(a)?;
    let cx = obj(&a["context"])?;
    let ev = obj(a.get("event").ok_or("invalid-args")?)?;
    let delta = ev.get("delta").and_then(Value::as_i64).unwrap_or(1);
    let item_arg = s_of(ev.get("itemId"));
    let mut live = None;
    let mut command = Value::Null;
    let mut handled = true;
    match ev.get("type").and_then(Value::as_str).ok_or("invalid-args")? {
        "sync" => {}
        "pick" => { p.set("typed", json!("")); live = p.press(order, json!({ "type": "pick", "delta": delta }))? }
        "clicker" => { let kind = if p.presenting { "step" } else { "pick" }; live = p.press(order, json!({ "type": kind, "delta": delta }))? }
        "step" if p.presenting => live = p.press(order, json!({ "type": "step", "delta": delta }))?,
        "black" if p.presenting => live = p.press(order, json!({ "type": "black" }))?,
        "step" | "black" => handled = false,
        "pickAt" => {
            let at = ev.get("partIndex").and_then(Value::as_i64).ok_or("invalid-args")?;
            let item = item_arg.ok_or("invalid-args")?;
            p.set("typed", json!(""));
            p.set("picked", json!({ "itemId": item, "partIndex": at }));
            p.set("selectedId", json!(item));
        }
        "show" => {
            let at = ev.get("partIndex").and_then(Value::as_i64).ok_or("invalid-args")?;
            let item = item_arg.ok_or("invalid-args")?;
            if p.presenting {
                p.set("picked", Value::Null);
                live = Some(json!({ "itemId": item, "partIndex": at, "black": false }));
            } else {
                p.set("picked", json!({ "itemId": item, "partIndex": at }));
                p.set("selectedId", json!(item));
            }
        }
        "select" => {
            let item = item_arg.ok_or("invalid-args")?;
            p.set("selectedId", json!(item));
            if p.presenting {
                let ready = Some(&item) != p.live_item.as_ref() && p.count(&item) > 0;
                p.set("picked", if ready { json!({ "itemId": item, "partIndex": 0 }) } else { Value::Null });
            }
            command = json!({ "type": "reveal", "itemId": item });
        }
        "item" if !p.counts.is_empty() => {
            // PRES-R41: no wrap; from none, ↓ the first and ↑ the last.
            let n = p.counts.len() as i64;
            let at = p.get("selectedId").and_then(|s| p.counts.iter().position(|(i, _)| *i == s));
            let next = match at { None => if delta > 0 { 0 } else { n - 1 }, Some(i) => (i as i64 + delta.signum()).clamp(0, n - 1) } as usize;
            let item = p.counts[next].0.clone();
            p.set("selectedId", json!(item));
            p.set("typed", json!(""));
            let has = p.count(&item) > 0;
            let ready = has && !(p.presenting && Some(&item) == p.live_item.as_ref());
            p.set("picked", if ready { json!({ "itemId": item, "partIndex": 0 }) } else { Value::Null });
            // One with no slides (a heading) has no outline to follow: the slides go to it all the same (Lars, 2026-11-07).
            command = json!({ "type": "item", "itemId": item, "reveal": !has, "focus": p.presenting });
        }
        "item" => handled = false,
        "move" => match p.get("selectedId") {
            Some(item) => command = json!({ "type": "move", "itemId": item, "by": delta.signum() }),
            None => handled = false,
        },
        "delete" => match p.get("selectedId") {
            // As an item's menu offers Radera (`itemActionsView`): not the item on the outputs.
            Some(item) if crate::page_models::removable(&item, p.live_item.as_deref()) => command = json!({ "type": "remove", "itemId": item }),
            _ => handled = false,
        },
        "add" => command = json!({ "type": "add" }),
        "start" => if can_start(cx, p.live) {
            live = Some(json!({ "presentationId": cx.get("presentationId").cloned().unwrap_or(Value::Null), "itemId": null, "partIndex": 0, "black": false }));
            command = json!({ "type": "start" });
        },
        "end" => if p.presenting { command = json!({ "type": "end" }) },
        "digit" if p.presenting => {
            let d = ev.get("digit").and_then(Value::as_i64).filter(|d| (0..10).contains(d)).ok_or("invalid-args")?;
            let mut typed = p.typed();
            typed.push_str(&d.to_string());
            let typed = typed[typed.len().saturating_sub(3)..].to_string();
            p.set("typed", json!(typed));
            let item = p.picked().map(|(i, _)| i).or_else(|| p.get("selectedId")).or_else(|| p.live_item.clone());
            let at = typed.parse::<i64>().unwrap_or(0) - 1;
            if let Some(item) = item { if at >= 0 && at < p.count(&item) { p.set("picked", json!({ "itemId": item, "partIndex": at })) } }
        }
        "digit" => handled = false,
        "clearTyped" => p.set("typed", json!("")),
        "escape" => {
            if !p.typed().is_empty() { p.set("typed", json!("")) }
            else if p.presenting && p.picked().is_some() {
                live = p.press(order, json!({ "type": "escape" }))?;
                if let Some(item) = p.live_item.clone() { p.set("selectedId", json!(item)) }
            } else { handled = false }
        }
        "enter" => {
            let on_page = ev.get("onPage").and_then(Value::as_bool).unwrap_or(false);
            let typed = p.typed();
            if !p.presenting || !(p.picked().is_some() || !typed.is_empty() || on_page) { handled = false }
            else {
                // A number with no such slide shows nothing; with none made ready, the next.
                p.set("typed", json!(""));
                let fits = p.picked().is_some_and(|(_, at)| typed.parse::<i64>().unwrap_or(0) - 1 == at);
                if typed.is_empty() || fits { live = p.press(order, json!({ "type": "enter" }))? }
            }
        }
        "added" => {
            let item = item_arg.ok_or("invalid-args")?;
            p.set("selectedId", json!(item));
            p.set("lastAddedId", json!(item));
        }
        _ => return Err("invalid-args".into()),
    }
    Ok(json!({ "state": p.st, "live": live.unwrap_or(Value::Null), "command": command, "handled": handled }))
}

/// ▶: not a template, and only while no presentation is presented (one at a time, `liveChangeView`).
fn can_start(cx: &Obj, live: &Obj) -> bool {
    cx.get("isTemplate") != Some(&json!(true)) && s_of(live.get("presentationId")).is_none()
}

/// `pageModelView` {state, context, order}: what the page shows of its state: the state as the context leaves it
/// (`sync`), whether ▶ may start, and the cue said over the live picture: the slide ↵ shows (`live.cued`), or that the
/// number typed has none (`live.noSuchSlide`), each with its number and item.
pub fn model(a: &Obj) -> R<Value> {
    let (p, _) = page(a)?;
    let cx = obj(&a["context"])?;
    let cue = if !p.presenting { Value::Null } else {
        let typed = p.typed();
        let target = p.picked().map(|(i, _)| i).or_else(|| p.get("selectedId")).or_else(|| p.live_item.clone());
        match (typed.parse::<i64>().ok(), target, p.picked()) {
            (Some(n), Some(t), _) if n < 1 || n > p.count(&t) => json!({ "text": "live.noSuchSlide", "n": n, "itemId": t }),
            (_, _, Some((item, at))) => json!({ "text": "live.cued", "n": at + 1, "itemId": item }),
            _ => Value::Null,
        }
    };
    Ok(json!({ "state": p.st, "canStart": can_start(cx, p.live), "cue": cue }))
}
