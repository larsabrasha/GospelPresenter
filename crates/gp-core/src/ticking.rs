// Markera, the running order's select mode (Sidebar.razor; Lars, 2026-11-03; the core's since 2026-11-22): items
// ticked, then removed together after a question. The same in every shell: the web's RunningOrder.tsx, the Mac and
// iOS app, the Linux app. The item on the outputs, black or not, cannot be removed (`itemActionsView`), so it cannot
// be ticked either. What a tick looks like and how a range is asked for (Shift+click, a drag) is the shell's.
use crate::args::*;
use serde_json::{json, Value};

fn strings(a: &Obj, k: &str) -> R<Vec<String>> {
    match a.get(k) {
        None | Some(Value::Null) => Ok(vec![]),
        Some(Value::Array(list)) => list.iter().map(|v| v.as_str().map(String::from).ok_or_else(|| "invalid-args".to_string())).collect(),
        _ => Err("invalid-args".into()),
    }
}

fn text(a: &Obj, k: &str) -> Option<String> { a.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from) }

/// `tickView` {order, shownId?, ticked, last?, event?}: the select mode after `event`, or as it stands without one.
/// `order` is the running order's ids, `ticked` those ticked, `last` where a range starts. Events:
/// {type: "start", first?} select mode begun, `first` (the row Markera was chosen on) ticked;
/// {type: "tick", itemId, range} a row ticked or unticked, or with `range` every row from `last` to it ticked;
/// {type: "all"} every tickable row ticked, or none when all were.
/// The answer: {ticked (in the running order), last, tickable, allTicked, remove: null or {count, title, text, n,
/// confirm, done}}, `remove` the question asked before the ticked are removed and the toast after (the texts' keys,
/// `n` their number); ids no longer in the order and the item shown are let go.
pub fn view(a: &Obj) -> R<Value> {
    let order = strings(a, "order")?;
    let kept = text(a, "shownId");
    let tickable: Vec<&String> = order.iter().filter(|id| Some(id.as_str()) != kept.as_deref()).collect();
    let mut ticked: Vec<String> = strings(a, "ticked")?;
    let mut last = text(a, "last");
    if let Some(event) = a.get("event") {
        let event = obj(event)?;
        match event.get("type").and_then(Value::as_str) {
            Some("start") => {
                let first = text(event, "first");
                ticked = first.iter().filter(|f| tickable.contains(f)).cloned().collect();
                last = first;
            }
            Some("tick") => {
                let item = id(event, "itemId")?;
                let range = event.get("range").and_then(Value::as_bool).unwrap_or(false);
                let at = |id: &str| order.iter().position(|x| x == id);
                match (range, last.as_deref().and_then(at), at(&item)) {
                    (true, Some(from), Some(to)) => {
                        for id in &order[from.min(to)..=from.max(to)] { if !ticked.contains(id) { ticked.push(id.clone()) } }
                    }
                    _ => {
                        let before = ticked.len();
                        ticked.retain(|x| x != &item);
                        if ticked.len() == before { ticked.push(item.clone()) }
                    }
                }
                last = Some(item);
            }
            Some("all") => {
                let all = !tickable.is_empty() && tickable.iter().all(|id| ticked.contains(id));
                ticked = if all { vec![] } else { tickable.iter().map(|s| s.to_string()).collect() };
            }
            _ => return Err("invalid-args".into()),
        }
    }
    let ticked: Vec<&String> = tickable.iter().copied().filter(|id| ticked.contains(id)).collect();
    let n = ticked.len();
    let remove = (n > 0).then(|| json!({
        "count": n,
        "title": "common.delete",
        "text": if n == 1 { "presentation.removeOne" } else { "presentation.removeMany" },
        "n": n,
        "confirm": "common.delete",
        "done": if n == 1 { "presentation.removedOne" } else { "presentation.removedMany" },
    }));
    Ok(json!({
        "ticked": ticked,
        "last": last,
        "tickable": tickable,
        "allTicked": !tickable.is_empty() && n == tickable.len(),
        "remove": remove,
    }))
}

#[cfg(test)]
#[path = "ticking_tests.rs"]
mod tests;
