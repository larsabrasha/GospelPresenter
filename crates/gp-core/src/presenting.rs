// Presenting's keys and marks as packages/core/src/presenting.ts has them, for the web's presentation page:
// `presentingKey` and `slideMarks`, pure, no SQL. The order is the running order's slides as [[itemId, slides]...]
// (`slideOrder`'s input); the web calls them on its own thread, so a key reaches the outputs at once.
use crate::args::*;
use serde_json::{json, Value};

/// A slide of the running order; `item` is None for the pointer before anything is shown.
#[derive(Clone, PartialEq)]
struct At { item: Option<String>, part: i64 }

/// `slideOrder`.
fn order_of(a: &Obj) -> R<Vec<At>> {
    let rows = a.get("order").and_then(Value::as_array).ok_or("invalid-args")?;
    let mut out = Vec::new();
    for r in rows {
        let item = r.get(0).and_then(Value::as_str).ok_or("invalid-args")?;
        let parts = r.get(1).and_then(Value::as_i64).ok_or("invalid-args")?;
        for part in 0..parts.max(0) { out.push(At { item: Some(item.to_string()), part }) }
    }
    Ok(out)
}

fn at_of(v: &Value) -> Option<At> {
    if v.is_null() { return None }
    Some(At { item: v.get("itemId")?.as_str().map(String::from), part: v.get("partIndex")?.as_i64()? })
}

fn index_of(order: &[At], at: &Option<At>) -> Option<usize> { at.as_ref().and_then(|at| order.iter().position(|s| s == at)) }

/// `stepped`: the first or the last when `from` is not in the order; none past either end.
fn stepped(order: &[At], from: &Option<At>, delta: i64) -> Option<At> {
    let i = match index_of(order, from) { None => if delta > 0 { 0 } else { order.len() as i64 - 1 }, Some(i) => i as i64 + delta };
    if i < 0 { None } else { order.get(i as usize).cloned() }
}

fn slide(a: &At) -> Value { json!({ "itemId": a.item, "partIndex": a.part }) }

/// `presentingKeyView` {order, state: {presenting, shown, picked}, key}: what presenting holds after the key, as
/// presentingKey answers it.
pub fn key(a: &Obj) -> R<Value> {
    let order = order_of(a)?;
    let state = obj(a.get("state").ok_or("invalid-args")?)?;
    let presenting = state.get("presenting").and_then(Value::as_bool).ok_or("invalid-args")?;
    let shown_v = state.get("shown").ok_or("invalid-args")?;
    let shown = at_of(shown_v).ok_or("invalid-args")?;
    let black = shown_v.get("black").and_then(Value::as_bool).ok_or("invalid-args")?;
    let picked = state.get("picked").and_then(at_of);
    let key = obj(a.get("key").ok_or("invalid-args")?)?;
    let delta = key.get("delta").and_then(Value::as_i64).unwrap_or(0);
    let mut next = (presenting, shown.clone(), black, picked.clone());
    let step = |from: &At| stepped(&order, &Some(from.clone()), 1);
    match key.get("type").and_then(Value::as_str).ok_or("invalid-args")? {
        "step" => if let Some(n) = stepped(&order, &Some(shown.clone()), delta) { next.1 = n; next.2 = false },
        "pick" => {
            let from = picked.clone().or_else(|| if presenting && shown.item.is_some() { Some(shown.clone()) } else { None });
            if let Some(n) = stepped(&order, &from, delta) { next.3 = Some(n) }
        }
        "enter" if presenting => match &picked {
            Some(p) => { next.1 = p.clone(); next.2 = false; next.3 = None }
            None => if let Some(n) = step(&shown) { next.1 = n; next.2 = false },
        },
        "black" if presenting => next.2 = true,
        "escape" if presenting && picked.is_some() => next.3 = None,
        "enter" | "black" | "escape" => {}
        _ => return Err("invalid-args".into()),
    }
    Ok(json!({
        "presenting": next.0,
        "shown": { "itemId": next.1.item, "partIndex": next.1.part, "black": next.2 },
        "picked": next.3.as_ref().map_or(Value::Null, slide),
    }))
}

/// `slideMarksView` {order, shown}: the slide marked VISAS and the one marked NÄSTA, as slideMarks marks them; either
/// null. VISAS is not marked after Släck (nor any slide when nothing is shown: its itemId is null, as no slide's);
/// NÄSTA still is, from the slide last shown.
pub fn marks(a: &Obj) -> R<Value> {
    let order = order_of(a)?;
    let shown_v = a.get("shown").ok_or("invalid-args")?;
    let shown = at_of(shown_v).ok_or("invalid-args")?;
    let black = shown_v.get("black").and_then(Value::as_bool).unwrap_or(false);
    let next = index_of(&order, &Some(shown.clone())).and_then(|i| order.get(i + 1));
    Ok(json!({
        "shown": if black { Value::Null } else { slide(&shown) },
        "next": next.map_or(Value::Null, slide),
    }))
}
