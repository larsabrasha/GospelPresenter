// What a slide shows besides a song's or Bible text, laid out for a shell that paints it (docs/native-slide-rendering.md,
// way 3): a picture slide's picture and a video's still, fitted to the stage (SlideView's `.slide-image`), and a
// slideshow's page or an overlay's (CustomPageView, docs/custom-slides.md): its ground, its pictures, rectangles,
// ellipses, lines and texts in drawing order. A page's text is laid out as the web lays it out, in the theme's song
// style at the element's size, from its box's top, its lines broken to the box's width and never made smaller.
use crate::args::*;
use crate::slide_layout::{layout, painted, style, Engine, STAGE};
use serde_json::{json, Map, Value};

/// The whole stage, as a box.
fn stage() -> Value { json!({ "x": 0, "y": 0, "w": STAGE.0, "h": STAGE.1 }) }

/// A picture by its blobs (its `full`, else its `thumb` while this device lacks it), in `box`, fitted (`contain`) or
/// filling it (`cover`).
fn picture(full: &Value, thumb: &Value, at: Value, fit: &str) -> Value {
    json!({ "kind": "picture", "full": full, "thumb": thumb, "box": at, "fit": fit })
}

/// A theme's ground for a slide kind (themes.ts's `backgroundOf`): a picture slide's the theme's `media`.
fn ground<'a>(def: &'a Obj, kind: &str) -> R<&'a Value> {
    let d = if kind == "media" { def.get("media") } else { def.get(kind).and_then(|k| k.get("background")) };
    d.ok_or_else(|| "invalid-args".into())
}

/// A picture or video slide: the theme's media ground and picture, and the slide's picture (a video's still) fitted
/// to the stage over it; an audio slide, the ground alone.
pub fn media(slide: &Obj, def: &Obj) -> R<(Value, Vec<Value>, Vec<Value>)> {
    let items = match slide.get("image").filter(|h| !h.is_null()) {
        Some(full) => vec![picture(full, slide.get("thumb").unwrap_or(&Value::Null), stage(), "contain")],
        None => vec![],
    };
    Ok((ground(def, "media")?.clone(), items, vec![]))
}

/// A slideshow's page as a slide: the stage's ground the theme's colour for the slide's kind (its own picture is not
/// drawn under a page, as SlideView's stage carries only the colour), then the page.
pub fn custom(e: &mut Engine, slide: &Obj, page: &Obj, def: &Obj) -> R<(Value, Vec<Value>, Vec<Value>)> {
    let kind = slide.get("kind").and_then(Value::as_str).unwrap_or("song");
    let colour = ground(def, kind)?.get("color").cloned().unwrap_or(Value::Null);
    Ok((json!({ "color": colour, "image": null, "fit": "cover", "scrim": 0 }), self::page(e, page, def)?, vec![]))
}

/// A page's items in drawing order: its own colour over the stage, its picture filling it, a PDF's page fitted to it,
/// then its elements.
pub fn page(e: &mut Engine, page: &Obj, def: &Obj) -> R<Vec<Value>> {
    let mut items = vec![];
    if let Some(c) = page.get("background").filter(|c| !c.is_null()) {
        items.push(json!({ "kind": "fill", "color": c, "box": stage() }));
    }
    for (k, fit) in [("backgroundPicture", "cover"), ("backgroundPage", "contain")] {
        if let Some(p) = page.get(k).filter(|p| !p.is_null()) {
            items.push(picture(&p["full"], &p["thumb"], stage(), fit));
        }
    }
    let main = obj(obj(def.get("song").ok_or("invalid-args")?)?.get("main").ok_or("invalid-args")?)?;
    for el in page.get("elements").and_then(Value::as_array).into_iter().flatten() {
        items.push(element(e, obj(el)?, main)?);
    }
    Ok(items)
}

/// An element's box from its start and its size, whichever way it runs (CustomPageView's `elementBox`).
fn element_box(o: &Obj) -> R<(f64, f64, f64, f64)> {
    let n = |k: &str| o.get(k).and_then(Value::as_f64).ok_or_else(|| "invalid-args".to_string());
    let (x, y, w, h) = (n("x")?, n("y")?, n("w")?, n("h")?);
    Ok((x.min(x + w), y.min(y + h), w.abs(), h.abs()))
}

fn element(e: &mut Engine, o: &Obj, main: &Obj) -> R<Value> {
    let (x, y, w, h) = element_box(o)?;
    let at = json!({ "x": x, "y": y, "w": w, "h": h });
    let given = |k: &str| o.get(k).cloned().unwrap_or(Value::Null);
    Ok(match o.get("kind").and_then(Value::as_str) {
        Some("text") => text(e, o, main, (x, y, w, h))?,
        Some("image") => picture(&o["picture"]["full"], &o["picture"]["thumb"], at, o.get("fit").and_then(Value::as_str).unwrap_or("contain")),
        // A line runs from its start to its end; without a colour of its own, the theme's text colour.
        Some("line") => {
            let n = |k: &str| o.get(k).and_then(Value::as_f64).unwrap_or(0.0);
            let stroke = o.get("stroke").filter(|s| !s.is_null()).cloned().unwrap_or_else(|| main.get("color").cloned().unwrap_or(Value::Null));
            json!({ "kind": "line", "from": [n("x"), n("y")], "to": [n("x") + n("w"), n("y") + n("h")], "stroke": stroke, "width": given("strokeWidth") })
        }
        Some(kind @ ("rect" | "ellipse")) => {
            json!({ "kind": kind, "box": at, "fill": given("fill"), "stroke": given("stroke"), "strokeWidth": given("strokeWidth"), "radius": given("radius") })
        }
        _ => return Err("invalid-args".into()),
    })
}

/// A page's text: the theme's song style at the element's size and weight, its own alignment and colour, from the
/// box's top, broken to its width (`white-space: pre-wrap`), never made smaller and clipped only by the stage.
fn text(e: &mut Engine, o: &Obj, main: &Obj, (x, y, w, h): (f64, f64, f64, f64)) -> R<Value> {
    let mut s: Map<String, Value> = main.clone();
    s.insert("fontSize".into(), o.get("size").cloned().ok_or("invalid-args")?);
    if o.get("bold").and_then(Value::as_bool) == Some(true) { s.insert("fontWeight".into(), json!(700)); }
    s.insert("align".into(), o.get("align").cloned().unwrap_or(json!("left")));
    if let Some(c) = o.get("color").filter(|c| !c.is_null()) { s.insert("color".into(), c.clone()); }
    s.insert("area".into(), json!({ "x": x, "y": y, "w": w, "h": h }));
    s.insert("valign".into(), json!("top"));
    let st = style(e, &s)?;
    let raw = o.get("text").and_then(Value::as_str).unwrap_or("");
    let shown = if st.uppercase { raw.to_uppercase() } else { raw.to_string() };
    let size = st.size;
    let l = layout(e, &shown, &[], &st, size, true);
    let mut out = painted(e, &shown, &[], &l, &st, size, "text");
    out["kind"] = json!("text");
    out["clip"] = stage();
    // An italic the faces do not have: the browser slants the upright, as the shell does.
    if o.get("italic").and_then(Value::as_bool) == Some(true) { out["italic"] = json!(true) }
    Ok(out)
}
