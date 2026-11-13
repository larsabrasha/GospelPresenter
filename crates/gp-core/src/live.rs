// Presenting (packages/core's presentingKey and slideMarks, presenting.ts), as a reducer: the shell sends what it
// holds and what was pressed, and shows what comes back.
//
// `pointer` is what the outputs show ({itemId, partIndex, black}); `picked` the slide made ready, outlined in blue,
// which ↵ shows. Before presenting the same keys move `picked` and nothing is shown.
use crate::args::*;
use crate::views::steps;
use serde_json::{json, Value};

#[derive(Clone, PartialEq)]
struct At { item: String, part: usize }

fn at_of(v: &Value) -> Option<At> {
    Some(At { item: v.get("itemId")?.as_str()?.to_string(), part: v.get("partIndex")?.as_u64()? as usize })
}
fn json_of(a: &Option<At>) -> Value {
    a.as_ref().map_or(Value::Null, |a| json!({ "itemId": a.item, "partIndex": a.part }))
}

pub async fn run(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    // The running order the shell shows, [[itemId, slides]...]; else worked out here.
    let given: Option<Vec<(String, usize)>> = a.get("order").and_then(Value::as_array).map(|o| o.iter()
        .filter_map(|x| Some((x.get(0)?.as_str()?.to_string(), x.get(1)?.as_u64()? as usize))).collect());
    let order: Vec<At> = match given { Some(g) => g, None => steps(&pid).await? }.into_iter()
        .flat_map(|(item, n)| (0..n).map(move |part| At { item: item.clone(), part })).collect();
    let presenting = a.get("presenting").and_then(Value::as_bool).unwrap_or(false);
    let mut pointer = a.get("pointer").and_then(at_of);
    let mut black = a.get("pointer").and_then(|p| p.get("black")).and_then(Value::as_bool).unwrap_or(false);
    let mut picked = a.get("picked").and_then(at_of);
    let index = |x: &Option<At>| x.as_ref().and_then(|x| order.iter().position(|s| s == x));
    // From `from` by `delta`: the first or the last when `from` is not in the order; nothing past either end.
    let from = |x: &Option<At>, delta: i64| -> Option<At> {
        let i = match index(x) { None => if delta > 0 { 0 } else { order.len() as i64 - 1 }, Some(i) => i as i64 + delta };
        if i < 0 { None } else { order.get(i as usize).cloned() }
    };
    let action = a.get("action").cloned().unwrap_or(Value::Null);
    let delta = action.get("delta").and_then(Value::as_i64).unwrap_or(1);
    let mut presenting_now = presenting;
    match action.get("type").and_then(Value::as_str).unwrap_or("") {
        // Space, PageDown/PageUp, a clicker: steps what is shown (a shell sends `pick` before presenting, as the web).
        "step" => if let Some(n) = from(&pointer, delta) { pointer = Some(n); black = false },
        "pick" => {
            let start = if picked.is_some() { picked.clone() } else if presenting { pointer.clone() } else { None };
            if let Some(n) = from(&start, delta) { picked = Some(n) }
        }
        // ↵: the slide made ready, else the next.
        "enter" if presenting => match picked.take() {
            Some(p) => { pointer = Some(p); black = false }
            None => if let Some(n) = from(&pointer, 1) { pointer = Some(n); black = false },
        },
        "black" if presenting => black = true,
        "escape" if presenting => { picked = None }
        // A slide clicked: shown at once while presenting; else made ready.
        "show" => {
            let target = at_of(&action).filter(|t| order.contains(t));
            if presenting { if target.is_some() { pointer = target; black = false; picked = None } } else { picked = target }
        }
        // Starta presentation: the slide made ready, else the first.
        "start" => { presenting_now = true; pointer = picked.take().or_else(|| order.first().cloned()); black = false }
        "stop" => { presenting_now = false; pointer = None; black = false; picked = None }
        _ => {}
    }
    // The marks: VISAS on the slide shown, NÄSTA on the one → shows next, after Släck too.
    let shown_at = index(&pointer);
    let next = shown_at.and_then(|i| order.get(i + 1)).cloned();
    let key = |x: &Option<At>| x.as_ref().map_or(Value::Null, |x| json!(format!("{}/{}", x.item, x.part)));
    Ok(json!({
        "presenting": presenting_now,
        "pointer": pointer.as_ref().map_or(Value::Null, |p| json!({ "itemId": p.item, "partIndex": p.part, "black": black })),
        "picked": json_of(&picked),
        "shown": if black || shown_at.is_none() { Value::Null } else { key(&pointer) },
        "next": key(&next),
    }))
}
