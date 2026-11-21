// The slideshows' and overlays' editor as every shell draws it (the web's custom-slides/slideModel.ts, Inspector.tsx,
// ElementPanel.tsx, LayerList.tsx, PageNavigator.tsx): each change made to a slideshow's pages (an element added,
// changed, moved in the drawing order or removed; a page added, copied, moved, removed; a page's background), checked
// as `updateCustomSlide` checks pages, with the limits the core holds; what a tap on the stage picks; and what the Format
// panel holds for the element picked, or the page. A shell draws the stage (slideLayoutView of `editorSlideView`),
// the controls and the page strip, and keeps Ångra's history of whole pages.
use crate::args::*;
use crate::pages::{ELEMENTS, PAGES};
use serde_json::{json, Value};

const W: f64 = 1920.0;
const H: f64 = 1080.0;

fn blank() -> Value { serde_json::from_str(crate::pages::BLANK_PAGE).unwrap() }

/// A new element of `kind` in the middle of the stage at a size that suits it, a picture fitted inside 800×450
/// (slideModel.ts's `newElement`).
fn new_element(kind: &str, id: &str, picture: Option<&Value>) -> R<Value> {
    let centred = |w: f64, h: f64| json!({ "id": id, "x": ((W - w) / 2.0).round(), "y": ((H - h) / 2.0).round(), "w": w, "h": h });
    let mut e = match kind {
        "text" => centred(1200.0, 160.0),
        "rect" | "roundedRect" => centred(640.0, 400.0),
        "ellipse" => centred(400.0, 400.0),
        "line" => json!({ "id": id, "x": (W - 800.0) / 2.0, "y": H / 2.0, "w": 800, "h": 0 }),
        "image" => {
            let p = picture.ok_or("invalid-args")?;
            let (pw, ph) = (p["width"].as_f64().unwrap_or(800.0), p["height"].as_f64().unwrap_or(450.0));
            let scale = (800.0 / pw).min(450.0 / ph).min(1.0);
            centred((pw * scale).round(), (ph * scale).round())
        }
        _ => return Err("invalid-args".into()),
    };
    let o = e.as_object_mut().unwrap();
    let mut set = |k: &str, v: Value| { o.insert(k.into(), v); };
    match kind {
        "text" => { for (k, v) in [("kind", json!("text")), ("text", json!("Text")), ("size", json!(96)), ("bold", json!(false)), ("italic", json!(false)), ("align", json!("center")), ("color", Value::Null)] { set(k, v) } }
        "rect" | "roundedRect" => { for (k, v) in [("kind", json!("rect")), ("fill", json!("#3b82f6")), ("stroke", Value::Null), ("strokeWidth", json!(0)), ("radius", json!(if kind == "rect" { 0 } else { 48 }))] { set(k, v) } }
        "ellipse" => { for (k, v) in [("kind", json!("ellipse")), ("fill", json!("#ef4444")), ("stroke", Value::Null), ("strokeWidth", json!(0)), ("radius", json!(0))] { set(k, v) } }
        "line" => { for (k, v) in [("kind", json!("line")), ("stroke", Value::Null), ("strokeWidth", json!(8))] { set(k, v) } }
        _ => { let p = picture.unwrap(); set("kind", json!("image")); set("picture", json!({ "full": p["full"], "thumb": p["thumb"] })); set("fit", json!("contain")); }
    }
    Ok(e)
}

/// A page's elements; get_mut, not IndexMut: a page of the wrong shape is refused, never a panic (which aborts the app).
fn elements(page: &mut Value) -> R<&mut Vec<Value>> { page.get_mut("elements").and_then(Value::as_array_mut).ok_or_else(|| "invalid-args".into()) }
fn at_of(list: &[Value], id: &str) -> Option<usize> { list.iter().position(|e| e["id"] == id) }
fn s<'a>(a: &'a Obj, k: &str) -> R<&'a str> { a.get(k).and_then(Value::as_str).ok_or_else(|| "invalid-args".into()) }
fn n(a: &Obj, k: &str) -> R<usize> { a.get(k).and_then(Value::as_u64).map(|v| v as usize).ok_or_else(|| "invalid-args".into()) }

/// `slideEditView` {pages, page, op, …}: the pages after one change to page `page` (or to the pages), checked as
/// `updateCustomSlide` checks them; and which page and element are then the ones open and picked. `op`:
/// `add` {kind, id, picture?} (at the limit nothing is added), `insert` {element, id} (pasted), `change` {id, patch}, `remove` {id}, `duplicate` {id,
/// newId} (a copy 40 down and right, above it), `reorder` {id, to: up, down, top, bottom}, `moveLayer` {from, to},
/// `background` {patch} (the page's background, picture or PDF page), `addPage` {copy, ids} (after `page`, blank or a
/// copy with the new ids `ids`; at the limit none), `removePage` (the last stays), `movePage` {to}. An overlay
/// (`overlay`: true) has one page and no background.
pub fn edit(a: &Obj) -> R<Value> {
    let mut pages = a.get("pages").and_then(Value::as_array).cloned().ok_or("invalid-args")?;
    let mut at = n(a, "page")?.min(pages.len().saturating_sub(1));
    let mut picked = a.get("picked").and_then(Value::as_str).map(String::from);
    let overlay = a.get("overlay").and_then(Value::as_bool).unwrap_or(false);
    let page = pages.get_mut(at).ok_or("invalid-args")?;
    match s(a, "op")? {
        "add" => {
            let id = s(a, "id")?;
            let e = new_element(s(a, "kind")?, id, a.get("picture"))?;
            let list = elements(page)?;
            if list.len() < ELEMENTS { list.push(e); picked = Some(id.into()) }
        }
        "change" => {
            let (id, patch) = (s(a, "id")?, a.get("patch").and_then(Value::as_object).ok_or("invalid-args")?);
            let list = elements(page)?;
            let i = at_of(list, id).ok_or("not-found")?;
            for (k, v) in patch { if k != "id" && k != "kind" { list[i][k] = v.clone() } }
        }
        "remove" => {
            let id = s(a, "id")?;
            elements(page)?.retain(|e| e["id"] != id);
            if picked.as_deref() == Some(id) { picked = None }
        }
        // Klistra in: an element copied or cut before, with a new id, 40 down and right of where it was (the web's paste).
        "insert" => {
            let mut e = a.get("element").filter(|e| e.is_object()).cloned().ok_or("invalid-args")?;
            let new_id = s(a, "id")?;
            e["id"] = json!(new_id);
            e["x"] = json!(e["x"].as_f64().unwrap_or(0.0) + 40.0);
            e["y"] = json!(e["y"].as_f64().unwrap_or(0.0) + 40.0);
            let list = elements(page)?;
            if list.len() < ELEMENTS { list.push(e); picked = Some(new_id.into()) }
        }
        "duplicate" => {
            let (id, new_id) = (s(a, "id")?, s(a, "newId")?);
            let list = elements(page)?;
            if let Some(i) = at_of(list, id).filter(|_| list.len() < ELEMENTS) {
                let mut copy = list[i].clone();
                copy["id"] = json!(new_id);
                copy["x"] = json!(copy["x"].as_f64().unwrap_or(0.0) + 40.0);
                copy["y"] = json!(copy["y"].as_f64().unwrap_or(0.0) + 40.0);
                list.push(copy);
                picked = Some(new_id.into());
            }
        }
        "reorder" => {
            let (id, to) = (s(a, "id")?, s(a, "to")?);
            let list = elements(page)?;
            if let Some(from) = at_of(list, id) {
                let last = list.len() - 1;
                let target = match to { "top" => last, "bottom" => 0, "up" => (from + 1).min(last), "down" => from.saturating_sub(1), _ => return Err("invalid-args".into()) };
                let e = list.remove(from);
                list.insert(target, e);
            }
        }
        "moveLayer" => {
            let (from, to) = (n(a, "from")?, n(a, "to")?);
            let list = elements(page)?;
            if from < list.len() && to < list.len() && from != to { let e = list.remove(from); list.insert(to, e); }
        }
        "background" => {
            if overlay { return Err("invalid-args".into()) }
            let o = page.as_object_mut().ok_or("invalid-args")?;
            for (k, v) in a.get("patch").and_then(Value::as_object).ok_or("invalid-args")? {
                if ["background", "backgroundPicture", "backgroundPage"].contains(&k.as_str()) { o.insert(k.clone(), v.clone()); }
            }
        }
        "addPage" if !overlay => {
            if pages.len() < PAGES {
                let copy = a.get("copy").and_then(Value::as_bool).unwrap_or(false);
                let mut new = if copy { pages[at].clone() } else { blank() };
                if copy {
                    let ids = a.get("ids").and_then(Value::as_array).cloned().unwrap_or_default();
                    for (i, e) in elements(&mut new)?.iter_mut().enumerate() {
                        e.as_object_mut().ok_or("invalid-args")?.insert("id".into(), ids.get(i).cloned().ok_or("invalid-args")?);
                    }
                }
                pages.insert(at + 1, new);
                at += 1;
                picked = None;
            }
        }
        "removePage" if !overlay => {
            if pages.len() > 1 { pages.remove(at); at = at.min(pages.len() - 1); picked = None }
        }
        "movePage" if !overlay => {
            let to = n(a, "to")?;
            if to < pages.len() && to != at { let p = pages.remove(at); pages.insert(to, p); at = to; }
        }
        _ => return Err("invalid-args".into()),
    }
    let mut blobs = Vec::new();
    let checked = if overlay { crate::pages::overlay_page(&pages[0], &mut blobs).map(|p| crate::json::J::Arr(vec![p]))? } else { crate::pages::pages(Some(&Value::Array(pages)), &mut blobs)? };
    Ok(json!({ "pages": serde_json::from_str::<Value>(&checked.stringify()).unwrap(), "page": at, "picked": picked }))
}

/// `slideHitView` {page, x, y, picked}: what a tap on the stage at (x, y) picks among the elements under it (the top
/// one first): the top one, or, when the picked one is under it, the one beneath it, and the top again after the
/// bottom (slideModel.ts's `nextBeneath`); null for none.
pub fn hit(a: &Obj) -> R<Value> {
    let page = a.get("page").ok_or("invalid-args")?;
    let (x, y) = (a.get("x").and_then(Value::as_f64).unwrap_or(-1.0), a.get("y").and_then(Value::as_f64).unwrap_or(-1.0));
    let num = |e: &Value, k: &str| e[k].as_f64().unwrap_or(0.0);
    // A line has no height: a band of 20 around it.
    let under = |e: &Value| {
        let (ex, ey, ew, eh) = (num(e, "x"), num(e, "y"), num(e, "w"), num(e, "h"));
        let pad = if eh.abs() < 20.0 { 10.0 } else { 0.0 };
        x >= ex.min(ex + ew) && x <= ex.max(ex + ew) && y >= ey.min(ey + eh) - pad && y <= ey.max(ey + eh) + pad
    };
    let stack: Vec<&str> = page["elements"].as_array().map(|l| l.iter().rev().filter(|e| under(e)).filter_map(|e| e["id"].as_str()).collect()).unwrap_or_default();
    if stack.is_empty() { return Ok(Value::Null) }
    let picked = a.get("picked").and_then(Value::as_str);
    Ok(json!(match picked.and_then(|p| stack.iter().position(|s| *s == p)) { Some(i) => stack[(i + 1) % stack.len()], None => stack[0] }))
}

fn control(id: &str, kind: &str, text: &str, value: Value) -> Value { json!({ "id": id, "kind": kind, "text": text, "value": value }) }
fn slider(id: &str, text: &str, value: &Value, min: i64, max: i64) -> Value { let mut c = control(id, "slider", text, value.clone()); c["min"] = json!(min); c["max"] = json!(max); c }
fn colour(id: &str, text: &str, value: &Value, empty: &str) -> Value { let mut c = control(id, "color", text, value.clone()); c["empty"] = json!(empty); c }
fn segments(id: &str, text: &str, value: &Value, options: &[(&str, &str)]) -> Value {
    let mut c = control(id, "segments", text, value.clone());
    c["options"] = Value::Array(options.iter().map(|(v, t)| json!({ "id": v, "text": t })).collect());
    c
}
fn action(id: &str, text: &str, destructive: bool) -> Value { let mut c = control(id, "action", text, Value::Null); c["destructive"] = json!(destructive); c }

/// `slideEditorView` {pages, page, picked, tab, overlay}: the Format panel. With an element picked: its tabs (Text, Stil
/// or Bild, then Ordna), the tab shown, and its controls (`change`'s patch keys are their ids; `empty` says what a colour
/// left empty is: the theme's or none), the layers in the drawing order (the top first, as Keynote lists them), and the
/// Ordna actions. With none: the page's background (not an overlay's), with Ta bort PDF-sida for a PDF's page. Also what
/// may be added now (the limits), and the Infoga menu's kinds.
pub fn view(a: &Obj) -> R<Value> {
    let pages = a.get("pages").and_then(Value::as_array).ok_or("invalid-args")?;
    let at = n(a, "page")?.min(pages.len().saturating_sub(1));
    let page = pages.get(at).ok_or("invalid-args")?;
    let overlay = a.get("overlay").and_then(Value::as_bool).unwrap_or(false);
    let list = page["elements"].as_array().cloned().unwrap_or_default();
    let e = a.get("picked").and_then(Value::as_str).and_then(|id| list.iter().find(|e| e["id"] == id));
    let insert = json!([{ "id": "text", "text": "slideEditor.text", "icon": "text" }, { "id": "image", "text": "slideEditor.image", "icon": "image" },
        { "id": "rect", "text": "slideEditor.rect", "icon": "rect" }, { "id": "roundedRect", "text": "slideEditor.roundedRect", "icon": "roundedRect" },
        { "id": "ellipse", "text": "slideEditor.ellipse", "icon": "ellipse" }, { "id": "line", "text": "slideEditor.line", "icon": "line" }]);
    let common = json!({ "insert": insert, "canAdd": list.len() < ELEMENTS, "canAddPage": !overlay && pages.len() < PAGES, "canRemovePage": !overlay && pages.len() > 1, "pages": pages.len() });
    let mut out = match e {
        Some(e) => {
            let kind = e["kind"].as_str().unwrap_or("");
            let own = match kind { "text" => "text", "image" => "image", _ => "style" };
            let tabs = [own, "arrange"];
            let tab = a.get("tab").and_then(Value::as_str).filter(|t| tabs.contains(t)).unwrap_or(own);
            let controls = match (tab, kind) {
                ("text", _) => vec![control("text", "textArea", "slideEditor.text", e["text"].clone()), slider("size", "slideEditor.size", &e["size"], 10, 400),
                    { let mut c = control("style", "switches", "slideEditor.style", Value::Null); c["options"] = json!([{ "id": "bold", "text": "slideEditor.bold", "on": e["bold"] }, { "id": "italic", "text": "slideEditor.italic", "on": e["italic"] }]); c },
                    segments("align", "slideEditor.align", &e["align"], &[("left", "slideEditor.left"), ("center", "slideEditor.center"), ("right", "slideEditor.right")]),
                    colour("color", "slideEditor.color", &e["color"], "theme")],
                ("style", "line") => vec![colour("stroke", "slideEditor.color", &e["stroke"], "theme"), slider("strokeWidth", "slideEditor.strokeWidth", &e["strokeWidth"], 1, 40)],
                ("style", _) => {
                    let mut c = vec![colour("fill", "slideEditor.fill", &e["fill"], "none"), colour("stroke", "slideEditor.stroke", &e["stroke"], "none"), slider("strokeWidth", "slideEditor.strokeWidth", &e["strokeWidth"], 0, 40)];
                    if kind == "rect" { c.push(slider("radius", "slideEditor.radius", &e["radius"], 0, 200)) }
                    c
                }
                ("image", _) => vec![segments("fit", "slideEditor.fit", &e["fit"], &[("contain", "slideEditor.contain"), ("cover", "slideEditor.cover")]), action("replaceImage", "slideEditor.replaceImage", false)],
                _ => vec![action("top", "slideEditor.toFront", false), action("bottom", "slideEditor.toBack", false), action("duplicate", "slideEditor.duplicate", false), action("remove", "slideEditor.removeElement", true)],
            };
            let tab_text = |t: &str| match t { "text" => "slideEditor.text", "image" => "slideEditor.image", "style" => "slideEditor.styleTab", _ => "slideEditor.arrange" };
            let layers: Vec<Value> = list.iter().enumerate().rev().map(|(i, x)| json!({ "id": x["id"], "kind": x["kind"], "index": i, "text": x["text"] })).collect();
            json!({ "element": e, "tabs": tabs.iter().map(|t| json!({ "id": t, "text": tab_text(t) })).collect::<Vec<_>>(), "tab": tab, "controls": controls,
                    "layers": if tab == "arrange" { json!(layers) } else { json!([]) } })
        }
        None if overlay => json!({ "element": null, "controls": [] }),
        None => {
            let mut c = vec![colour("background", "slideEditor.background", &page["background"], "theme"),
                action("backgroundPicture", if page["backgroundPicture"].is_null() { "slideEditor.backgroundImage" } else { "slideEditor.replaceBackground" }, false)];
            if !page["backgroundPicture"].is_null() { c.push(action("removeBackgroundPicture", "slideEditor.removeBackground", true)) }
            if !page["backgroundPage"].is_null() { c.push(action("removeBackgroundPage", "slideEditor.removePdfPage", true)) }
            json!({ "element": null, "controls": c, "pageTitle": { "text": "slideEditor.page", "n": at + 1 } })
        }
    };
    for (k, v) in common.as_object().unwrap() { out[k] = v.clone() }
    Ok(out)
}

/// `editorSlideView` {page, overlay}: a page as a slide the stage draws (slideLayoutView), as the slideshow's own
/// slides are made (slides.rs `custom`): a PDF's page a picture slide, else a song slide holding the page.
pub fn slide(a: &Obj) -> R<Value> {
    let page = a.get("page").cloned().ok_or("invalid-args")?;
    let pdf = page.get("backgroundPage").filter(|p| !p.is_null()).cloned();
    Ok(json!({ "key": "editor", "kind": if pdf.is_some() { "media" } else { "song" }, "text": "", "verses": null, "label": null, "credits": null,
               "image": pdf.as_ref().map_or(Value::Null, |p| p["full"].clone()), "thumb": pdf.as_ref().map_or(Value::Null, |p| p["thumb"].clone()), "custom": page }))
}

#[cfg(test)]
#[path = "slide_editor_tests.rs"]
mod tests;
