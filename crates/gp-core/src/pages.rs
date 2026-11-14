// packages/core/src/custom-slides.ts's schemas: a slideshow's page (and an overlay's), checked as zod checks it and
// given back in zod's order, so the JSON the core stores is the TS core's; and the pictures a page draws.
use crate::args::*;
use crate::json::J;
use serde_json::Value;

const CANVAS: (f64, f64) = (1920.0, 1080.0);
const ELEMENTS: usize = 100;
const PAGES: usize = 100;
const TEXT: usize = 2000;

fn bad<T>() -> R<T> { Err("invalid-args".into()) }

/// `z.number()` between `lo` and `hi` (finite: JSON has no other).
pub fn num(o: &Obj, k: &str, lo: f64, hi: f64) -> R<J> {
    match o.get(k).and_then(Value::as_f64) { Some(f) if f >= lo && f <= hi => Ok(J::Num(f)), _ => bad() }
}

fn int_j(o: &Obj, k: &str, lo: i64, hi: i64) -> R<J> { int(o, k, lo, hi).map(|i| J::Num(i as f64)) }
fn bool_j(o: &Obj, k: &str) -> R<J> { boolean(o, k).map(J::Bool) }
pub fn enum_j(o: &Obj, k: &str, options: &[&str]) -> R<J> { one_of(o, k, options).map(J::Str) }

/// `/^#[0-9a-f]{6}$/i`, or null; kept as written.
fn color(o: &Obj, k: &str) -> R<J> {
    match o.get(k) {
        Some(Value::Null) => Ok(J::Null),
        Some(Value::String(c)) if c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit()) => Ok(J::str(c)),
        _ => bad(),
    }
}

/// `pictureSchema`: a picture's two blobs, as a page keeps them.
pub fn picture(v: &Value, blobs: &mut Vec<String>) -> R<J> {
    let o = obj(v)?;
    let (full, thumb) = (media_hash(o, "full")?, media_hash(o, "thumb")?);
    blobs.extend([full.clone(), thumb.clone()]);
    Ok(J::obj(vec![("full", J::Str(full)), ("thumb", J::Str(thumb))]))
}

fn opt_picture(o: &Obj, k: &str, blobs: &mut Vec<String>) -> R<J> {
    match o.get(k) { Some(Value::Null) => Ok(J::Null), Some(v) => picture(v, blobs), None => bad() }
}

/// An element: its box, then its kind's fields (`elementSchema`, a union by `kind`).
fn element(v: &Value, blobs: &mut Vec<String>) -> R<J> {
    let o = obj(v)?;
    let kind = o.get("kind").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "text" | "image" | "rect" | "ellipse" | "line") { return bad() }
    let eid = match o.get("id") { Some(Value::String(s)) if (1..=40).contains(&s.chars().count()) => J::str(s), _ => return bad() };
    let reach = |k: &str, size: f64| num(o, k, -2.0 * size, 3.0 * size);
    let mut fields = vec![("id", eid), ("x", reach("x", CANVAS.0)?), ("y", reach("y", CANVAS.1)?), ("w", reach("w", CANVAS.0)?), ("h", reach("h", CANVAS.1)?), ("kind", J::str(kind))];
    match kind {
        "text" => {
            let text = match o.get("text") { Some(Value::String(t)) if t.chars().count() <= TEXT => J::str(t), _ => return bad() };
            fields.extend([("text", text), ("size", int_j(o, "size", 10, 400)?), ("bold", bool_j(o, "bold")?), ("italic", bool_j(o, "italic")?),
                ("align", enum_j(o, "align", &["left", "center", "right"])?), ("color", color(o, "color")?)]);
        }
        "image" => {
            let pic = match o.get("picture") { Some(p) => picture(p, blobs)?, None => return bad() };
            fields.extend([("picture", pic), ("fit", enum_j(o, "fit", &["contain", "cover"])?)]);
        }
        "line" => fields.extend([("stroke", color(o, "stroke")?), ("strokeWidth", num(o, "strokeWidth", 1.0, 100.0)?)]),
        _ => fields.extend([("fill", color(o, "fill")?), ("stroke", color(o, "stroke")?), ("strokeWidth", num(o, "strokeWidth", 0.0, 100.0)?),
            ("radius", num(o, "radius", 0.0, CANVAS.1 / 2.0)?)]),
    }
    Ok(J::obj(fields))
}

/// `customPageSchema`: a page, and the blobs of every picture it draws, in the order `customPageBlobs` lists them.
pub fn page(v: &Value, blobs: &mut Vec<String>) -> R<J> {
    let o = obj(v)?;
    let background = color(o, "background")?;
    let (picture, pdf) = (opt_picture(o, "backgroundPicture", blobs)?, opt_picture(o, "backgroundPage", blobs)?);
    let elements = match o.get("elements") {
        Some(Value::Array(xs)) if xs.len() <= ELEMENTS => xs.iter().map(|e| element(e, blobs)).collect::<R<Vec<_>>>()?,
        _ => return bad(),
    };
    Ok(J::obj(vec![("background", background), ("backgroundPicture", picture), ("backgroundPage", pdf), ("elements", J::Arr(elements))]))
}

/// `customPagesSchema`: 1 to 100 pages.
pub fn pages(v: Option<&Value>, blobs: &mut Vec<String>) -> R<J> {
    match v {
        Some(Value::Array(xs)) if (1..=PAGES).contains(&xs.len()) => Ok(J::Arr(xs.iter().map(|p| page(p, blobs)).collect::<R<Vec<_>>>()?)),
        _ => bad(),
    }
}

/// `slideDeckPagesSchema` made a slideshow's pages (`pdfPages`): each the picture of its page on black.
pub fn pdf_pages(v: Option<&Value>, blobs: &mut Vec<String>) -> R<J> {
    let Some(Value::Array(xs)) = v else { return bad() };
    if !(1..=PAGES).contains(&xs.len()) { return bad() }
    let pages = xs.iter().map(|p| {
        let pic = picture(p, blobs)?;
        Ok(J::obj(vec![("background", J::str("#000000")), ("backgroundPicture", J::Null), ("backgroundPage", pic), ("elements", J::Arr(vec![]))]))
    });
    Ok(J::Arr(pages.collect::<R<Vec<_>>>()?))
}

/// An overlay's page: a slideshow's page, its background none; the blobs only of its elements' pictures.
pub fn overlay_page(v: &Value, blobs: &mut Vec<String>) -> R<J> {
    let mut all = Vec::new();
    let J::Obj(mut fields) = page(v, &mut all)? else { unreachable!() };
    for f in fields.iter_mut().take(3) { f.1 = J::Null }
    if let Some((_, J::Arr(elements))) = fields.get(3) {
        for e in elements {
            if let J::Obj(ef) = e {
                if let Some((_, J::Obj(p))) = ef.iter().find(|(k, _)| k == "picture") {
                    for (_, h) in p { if let J::Str(h) = h { blobs.push(h.clone()) } }
                }
            }
        }
    }
    Ok(J::Obj(fields))
}

/// `blankPage()` as stored.
pub const BLANK_PAGE: &str = r#"{"background":null,"backgroundPicture":null,"backgroundPage":null,"elements":[]}"#;
