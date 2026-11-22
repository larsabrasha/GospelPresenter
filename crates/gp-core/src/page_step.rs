// One step of a presentation's page, the whole of it (Lars, 2026-11-21): what every shell otherwise chains by hand
// after a key or a tap, in one call. The page's event (`pageEventView`), the change it makes to the app's live state
// with the overlays' rules (`liveChangeView`), the page as that change leaves it (`sync`), the marks VISAS and NÄSTA on
// the presented page (`slideMarksView`), and whether ▶ may start and the cue (`pageModelView`). Each of those stays a
// view of its own; this only runs them in the order the Mac app's Model.send and Live.set, and the terminal's App, ran
// them. The shell holds the page's state and the live state, and keeps what this answers.
use crate::args::*;
use serde_json::{json, Map, Value};

fn some(v: Option<&Value>) -> Option<&str> { v.and_then(Value::as_str).filter(|s| !s.is_empty()) }

fn args(v: Value) -> Obj { v.as_object().cloned().unwrap_or_default() }

/// The context the page's views take: the open presentation, whether it is a template, whether it is the one presented,
/// and the live state.
fn context(open: Option<&str>, template: &Value, live: &Map<String, Value>) -> Value {
    let presenting = open.is_some() && some(live.get("presentationId")) == open;
    json!({ "presentationId": open, "isTemplate": template, "presenting": presenting, "live": live })
}

/// `pageStepView` {state, context: {presentationId, isTemplate}, live, order, overlays, liveOrder?, liveOverlays?, and
/// `event` or `change`}: a page's event, or a change of the live state made outside the page's keys (Avsluta asked and
/// confirmed, an overlay turned on), carried through to its end.
///
/// `live` is the app's live state; `order` and `overlays` the open page's running order (each item's id and number of
/// slides) and the overlay each item carries; `liveOrder` and `liveOverlays` the same of the presented page where it is
/// another than the open one. Answers {state, live, liveChanged, refused (`another-presented`, the live state then
/// unchanged), handled, command (the page's: a dialog, a mutation, a scroll), marks ({shown, next} on the presented
/// page, null while nothing is), canStart, cue, change}. Another window of the same device follows a live change with an
/// event `sync` of its own.
///
/// With `remote: true` the live state is not this step's to change: it belongs to a session on another device, driven
/// by remote control, or on the web to the window's live channel, which changes it as its owner. The step then leaves
/// `live` as it is and answers the change asked for as `change` (null without one), for the shell to send on; the
/// owner applies it with `liveChangeView` and the page follows its answer with `sync`. Without it, `change` is the one
/// applied or refused.
pub fn step(a: &Obj) -> R<Value> {
    let cx = obj(a.get("context").ok_or("invalid-args")?)?;
    let open = some(cx.get("presentationId"));
    let template = cx.get("isTemplate").cloned().unwrap_or(json!(false));
    let order = a.get("order").cloned().ok_or("invalid-args")?;
    let mut live = obj(a.get("live").ok_or("invalid-args")?)?.clone();
    let mut state = a.get("state").cloned().unwrap_or(json!({}));
    let remote = a.get("remote").and_then(Value::as_bool).unwrap_or(false);
    let (mut handled, mut command, mut refused, mut changed) = (true, Value::Null, Value::Null, false);
    let change = match (a.get("event"), a.get("change")) {
        (Some(event), _) => {
            let answer = crate::page_state::event(&args(json!({
                "state": state, "context": context(open, &template, &live), "order": order, "event": event,
            })))?;
            state = answer["state"].clone();
            handled = answer["handled"].as_bool().unwrap_or(true);
            command = answer["command"].clone();
            answer["live"].clone()
        }
        (None, Some(change)) => change.clone(),
        (None, None) => return Err("invalid-args".into()),
    };
    if change.is_object() && !remote {
        // The overlays of the presentation the change is about: the one it starts, else the one presented.
        let about = some(change.get("presentationId")).or_else(|| some(live.get("presentationId")));
        let overlays = if about.is_some() && about == open { a.get("overlays") } else { a.get("liveOverlays") };
        let answer = crate::live_state::change(&args(json!({
            "pointer": live, "change": change, "overlays": overlays.cloned().unwrap_or(json!({})),
        })))?;
        match answer.get("pointer").and_then(Value::as_object) {
            Some(next) => {
                live = next.clone();
                changed = true;
                let synced = crate::page_state::event(&args(json!({
                    "state": state, "context": context(open, &template, &live), "order": order, "event": { "type": "sync" },
                })))?;
                state = synced["state"].clone();
            }
            None => refused = answer.get("refused").cloned().unwrap_or(Value::Null),
        }
    }
    let presented = some(live.get("presentationId"));
    let live_order = if presented.is_some() && presented == open { Some(&order) } else { a.get("liveOrder").filter(|o| o.is_array()) };
    let marks = match (presented, live_order) {
        (Some(_), Some(o)) => {
            let field = |k: &str, or: Value| live.get(k).filter(|v| !v.is_null()).cloned().unwrap_or(or);
            let shown = json!({ "itemId": field("itemId", Value::Null), "partIndex": field("partIndex", json!(0)), "black": field("black", json!(false)) });
            crate::presenting::marks(&args(json!({ "order": o, "shown": shown })))?
        }
        _ => Value::Null,
    };
    let model = crate::page_state::model(&args(json!({ "state": state, "context": context(open, &template, &live), "order": order })))?;
    Ok(json!({
        "state": model["state"], "live": live, "liveChanged": changed, "refused": refused, "handled": handled,
        "command": command, "marks": marks, "canStart": model["canStart"], "cue": model["cue"],
        "change": if change.is_object() { change } else { Value::Null },
    }))
}

#[cfg(test)]
#[path = "page_step_tests.rs"]
mod tests;
