// What the outputs of a session elsewhere show (spec 04 §5, §6; the web's live/owner.ts shownOnOutputs and
// live-protocol.ts's toPublicSlide and toCanvas; the core's since 2026-11-22, so every shell that presents reports the
// same): a public output gets the slide as data with its theme (never HTML, D25), cut to what a report may carry; a
// paired screen the projector's canvas, the overlay's page with it. Null: the waiting screen (black, or nothing).
use crate::args::*;
use serde_json::{json, Map, Value};

/// What one public slide may hold (PUBLIC_SLIDE_LIMITS), and an overlay's text (OVERLAY_LIMITS.content).
const TEXT: usize = 5000;
const SEGMENTS: usize = 100;
const CREDITS: usize = 500;
const OVERLAY: usize = 2000;
/// How long a page on a canvas may be, as JSON (CANVAS_PAGE_MAX).
const PAGE_MAX: usize = 20 * 1024;

/// The first `n` UTF-16 units of `s`, as JavaScript's slice counts them.
fn cut(s: &str, n: usize) -> String {
    let mut units = 0;
    s.chars().take_while(|c| { units += c.len_utf16(); units <= n }).collect()
}

fn len16(s: &str) -> usize { s.encode_utf16().count() }

/// A theme on the wire: its id, and an own theme's definition (a built-in's is not sent).
fn theme_on_wire(theme: &Value, out: &mut Map<String, Value>) {
    let id = theme["id"].as_str().unwrap_or("classic");
    out.insert("themeId".into(), json!(id));
    if crate::themes::built_in(id).is_none() { out.insert("theme".into(), theme["definition"].clone()); }
}

/// `toPublicSlide`: a slide cut to the limits, with its theme and the overlay's text.
fn public_slide(slide: &Value, theme: &Value, overlay: Option<&str>) -> Value {
    let mut budget = TEXT;
    let verses = slide["verses"].as_array().map(|vs| {
        Value::Array(vs.iter().take(SEGMENTS).filter_map(|seg| {
            if budget == 0 { return None }
            let t = cut(seg["t"].as_str().unwrap_or(""), budget);
            budget -= len16(&t);
            Some(json!({ "n": seg["n"], "t": t }))
        }).collect())
    }).unwrap_or(Value::Null);
    let mut out = Map::new();
    out.insert("kind".into(), slide["kind"].clone());
    out.insert("text".into(), json!(cut(slide["text"].as_str().unwrap_or(""), TEXT)));
    out.insert("verses".into(), verses);
    out.insert("image".into(), slide.get("image").cloned().unwrap_or(Value::Null));
    out.insert("credits".into(), slide["credits"].as_str().map_or(Value::Null, |c| json!(cut(c, CREDITS))));
    theme_on_wire(theme, &mut out);
    out.insert("overlay".into(), overlay.map_or(Value::Null, |o| json!(cut(o, OVERLAY))));
    Value::Object(out)
}

/// A page cut to PAGE_MAX as JSON: the elements drawn last (on top) go first.
fn cut_page(page: &Value) -> Value {
    let mut page = page.clone();
    while let Some(elements) = page["elements"].as_array() {
        if elements.is_empty() || len16(&page.to_string()) <= PAGE_MAX { break }
        let fewer: Vec<Value> = elements[..elements.len() - 1].to_vec();
        page["elements"] = Value::Array(fewer);
    }
    page
}

/// `customPageText`: a page's texts, top to bottom, left to right, each trimmed, a line each.
fn page_text(page: &Value) -> String {
    let mut texts: Vec<(f64, f64, String)> = page["elements"].as_array().into_iter().flatten()
        .filter(|e| e["kind"] == json!("text") && !e["text"].as_str().unwrap_or("").trim().is_empty())
        .map(|e| (e["y"].as_f64().unwrap_or(0.0), e["x"].as_f64().unwrap_or(0.0), e["text"].as_str().unwrap_or("").trim().to_string()))
        .collect();
    texts.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    texts.into_iter().map(|t| t.2).collect::<Vec<_>>().join("\n")
}

fn has_elements(page: &Value) -> bool { page["elements"].as_array().is_some_and(|e| !e.is_empty()) }

/// `shownOnOutputsView` {pointer: {presentationId, black}, shown: liveSlideView's answer, video: the video's place or
/// null}: {slide, canvas}, what a public output and a paired screen get; both null while black, nothing presented, or
/// nothing selected and no overlay. A video slide's canvas carries where the video is; a slideshow's its page.
pub fn view(a: &Obj) -> R<Value> {
    let pointer = obj(a.get("pointer").ok_or("invalid-args")?)?;
    let shown = obj(a.get("shown").ok_or("invalid-args")?)?;
    let none = json!({ "slide": null, "canvas": null });
    if pointer.get("presentationId").is_none_or(Value::is_null) || pointer.get("black").and_then(Value::as_bool) == Some(true) { return Ok(none) }
    let slide = shown.get("slide").filter(|s| !s.is_null());
    let overlay = shown.get("overlay").filter(|o| !o.is_null());
    let theme = shown.get("theme").cloned().unwrap_or(Value::Null);
    let text = overlay.map(page_text).filter(|t| !t.is_empty());
    if slide.is_none() && !overlay.is_some_and(has_elements) { return Ok(none) }
    let blank = json!({ "kind": "song", "text": "", "verses": null, "image": null, "credits": null });
    let public = if slide.is_some() || text.is_some() { public_slide(slide.unwrap_or(&blank), &theme, text.as_deref()) } else { Value::Null };
    let mut canvas = Map::new();
    canvas.insert("slide".into(), slide.map_or(Value::Null, |s| {
        let p = public_slide(s, &theme, None);
        let mut c = json!({ "kind": p["kind"], "text": p["text"], "verses": p["verses"], "image": p["image"], "credits": p["credits"] });
        if s.get("video").is_some_and(|v| !v.is_null()) {
            let v = a.get("video").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| {
                let mut v = s["video"].clone();
                v["playing"] = json!(false);
                v["position"] = json!(0);
                v["at"] = a.get("now").cloned().unwrap_or(json!(0));
                v
            });
            c["video"] = v;
        }
        if let Some(page) = s.get("custom").filter(|p| !p.is_null()) { c["custom"] = cut_page(page) }
        c
    }));
    theme_on_wire(&theme, &mut canvas);
    canvas.insert("overlay".into(), overlay.filter(|o| has_elements(o)).map_or(Value::Null, cut_page));
    Ok(json!({ "slide": public, "canvas": canvas }))
}

/// `outputRowsView` {displays, sessions, online, chosen, sessionId}: Utgångar's saved screens and public outputs
/// (spec 04 §1; the web's useOutputs.ts), the screens first, each in the order made: whether this session chose it,
/// sends to it (chosen, online, no other session on it), is offline (a saved screen with no page open: it cannot be
/// switched on, LIVE-A21), the name of another presentation sending to it, how many watch it; `line`, what is written
/// under it ({text, args, warn} a text's key, or {viewers}, or null); and `takeOver`, the question before taking it
/// from that presentation (LIVE-R23), its texts' keys and their values.
pub fn output_rows(a: &Obj) -> R<Value> {
    let list = |k: &str| a.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    let has = |k: &str, id: &str| list(k).iter().any(|v| v.as_str() == Some(id));
    let me = a.get("sessionId").and_then(Value::as_str).unwrap_or("");
    let sessions = list("sessions");
    let mut displays = list("displays");
    // Screens before public outputs, each kind in the order made (a stable sort).
    displays.sort_by_key(|d| d["kind"] != json!("screen"));
    let rows: Vec<Value> = displays.iter().map(|d| {
        let id = d["id"].as_str().unwrap_or("");
        let on = |s: &Value| s["outputs"].as_array().into_iter().flatten().any(|o| o["id"].as_str() == Some(id));
        let elsewhere = sessions.iter().find(|s| s["id"].as_str() != Some(me) && on(s));
        let offline = d["kind"] == json!("screen") && !has("online", id);
        let chosen = has("chosen", id);
        let viewers = sessions.iter().find(|s| s["id"].as_str() == Some(me))
            .and_then(|s| s["outputs"].as_array().into_iter().flatten().find(|o| o["id"].as_str() == Some(id)).map(|o| o["viewers"].clone()));
        let name = d["name"].as_str().unwrap_or("");
        let take_over = elsewhere.map(|s| match s["presentationName"].as_str().filter(|n| !n.is_empty()) {
            Some(p) => json!({ "title": "live.takeOverTitle", "text": "live.takeOverText", "args": { "output": name, "presentation": p }, "confirm": "live.takeOver" }),
            None => json!({ "title": "live.takeOverTitle", "text": "live.takeOverTextUnknown", "args": { "output": name }, "confirm": "live.takeOver" }),
        });
        let sending = chosen && elsewhere.is_none() && !offline;
        // The line under the row: offline (a warning while chosen), another presentation's, or how many watch.
        let line = if offline { json!({ "text": "screens.offline", "args": {}, "warn": chosen }) }
            else if let Some(s) = elsewhere { json!({ "text": "displays.sending", "args": { "name": s["presentationName"].as_str().unwrap_or("") }, "warn": false }) }
            else if d["kind"] == json!("public") && sending && viewers.as_ref().is_some_and(|v| v.is_number()) { json!({ "viewers": viewers }) }
            else { Value::Null };
        json!({
            "id": id, "name": name, "kind": d["kind"], "chosen": chosen, "sending": sending, "line": line,
            "offline": offline, "elsewhere": elsewhere.map(|s| s["presentationName"].as_str().unwrap_or("")), "viewers": viewers, "takeOver": take_over,
        })
    }).collect();
    Ok(json!({ "rows": rows }))
}

#[cfg(test)]
#[path = "live_report_tests.rs"]
mod tests;
