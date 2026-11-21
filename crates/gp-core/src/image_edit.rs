// A library picture's edit (MEDIA-R19, the web's media/imageEdit.ts, image-editor/ImageEditor.tsx and CropFrame.tsx):
// straightened (grown so no corner is empty), turned a quarter at a time, mirrored and cut to a crop in fractions of
// the turned picture, as Photos on an iPhone. Each step of the editor is worked out here (`imageEditView`), and how to
// draw the edited picture as a list of transforms a shell applies to its canvas (`imageDrawView`), so every shell draws
// the same picture the web stores; the drawing and encoding are the shell's.
use crate::args::*;
use serde_json::{json, Value};

/// The smallest crop, a fraction of either side (CropFrame.tsx's MIN).
const MIN: f64 = 0.08;

fn no_edit() -> Value { json!({ "straighten": 0, "rotate": 0, "flip": false, "crop": { "x": 0, "y": 0, "w": 1, "h": 1 } }) }

#[derive(Clone, Copy)]
struct Crop { x: f64, y: f64, w: f64, h: f64 }

fn crop_of(e: &Value) -> Crop {
    let c = &e["crop"];
    let f = |k: &str, d: f64| c[k].as_f64().unwrap_or(d);
    Crop { x: f("x", 0.0), y: f("y", 0.0), w: f("w", 1.0), h: f("h", 1.0) }
}

fn crop_json(c: Crop) -> Value { json!({ "x": c.x, "y": c.y, "w": c.w, "h": c.h }) }
fn rotate_of(e: &Value) -> i64 { e["rotate"].as_i64().unwrap_or(0) }

/// The size of a picture turned by `rotate` (`turnedSize`).
fn turned(w: f64, h: f64, rotate: i64) -> (f64, f64) { if rotate == 90 || rotate == 270 { (h, w) } else { (w, h) } }

/// How much a picture turned `degrees` within its own frame must grow so no corner is empty (`straightenScale`).
fn grow(w: f64, h: f64, degrees: f64) -> f64 {
    let a = degrees.abs().to_radians();
    ((w * a.cos() + h * a.sin()) / w).max((w * a.sin() + h * a.cos()) / h)
}

/// The edited picture's size in the original's pixels (`editedSize`).
fn edited(w: f64, h: f64, e: &Value) -> (f64, f64) {
    let (tw, th) = turned(w, h, rotate_of(e));
    let c = crop_of(e);
    ((tw * c.w).round().max(1.0), (th * c.h).round().max(1.0))
}

/// A crop of `aspect` (width / height), as large as fits, in the middle of a frame `fw` × `fh` (`cropOfAspect`).
fn crop_of_aspect(aspect: Option<f64>, fw: f64, fh: f64) -> Crop {
    let Some(aspect) = aspect else { return Crop { x: 0.0, y: 0.0, w: 1.0, h: 1.0 } };
    let frame = fw / fh;
    if aspect > frame { let h = frame / aspect; Crop { x: 0.0, y: (1.0 - h) / 2.0, w: 1.0, h } } else { let w = aspect / frame; Crop { x: (1.0 - w) / 2.0, y: 0.0, w, h: 1.0 } }
}

/// The crop formats in the web's order: their id, their text's key (or the words themselves), and the aspect.
fn aspect_of(format: &str, w: f64, h: f64) -> Option<f64> {
    match format { "16:9" => Some(16.0 / 9.0), "original" => Some(w / h), "4:3" => Some(4.0 / 3.0), "square" => Some(1.0), _ => None }
}

fn is_no_edit(e: &Value) -> bool {
    let c = crop_of(e);
    e["straighten"].as_f64().unwrap_or(0.0) == 0.0 && rotate_of(e) == 0 && !e["flip"].as_bool().unwrap_or(false) && c.x == 0.0 && c.y == 0.0 && c.w == 1.0 && c.h == 1.0
}

fn clamp(n: f64, lo: f64, hi: f64) -> f64 { n.max(lo).min(hi) }

/// `crop` with a corner dragged by (dx, dy), fractions; with an aspect the height follows the width (`dragCorner`).
fn drag_corner(c: Crop, corner: &str, dx: f64, dy: f64, aspect: Option<f64>, frame_aspect: f64) -> Crop {
    let (left, top) = (corner == "nw" || corner == "sw", corner == "nw" || corner == "ne");
    let (mut x0, mut y0, mut x1, mut y1) = (c.x, c.y, c.x + c.w, c.y + c.h);
    if left { x0 = clamp(x0 + dx, 0.0, x1 - MIN) } else { x1 = clamp(x1 + dx, x0 + MIN, 1.0) }
    match aspect {
        Some(aspect) => {
            let mut h = (x1 - x0) * frame_aspect / aspect;
            let room = if top { y1 } else { 1.0 - y0 };
            if h > room {
                h = room;
                let w = h * aspect / frame_aspect;
                if left { x0 = x1 - w } else { x1 = x0 + w }
            }
            if top { y0 = y1 - h } else { y1 = y0 + h }
        }
        None => if top { y0 = clamp(y0 + dy, 0.0, y1 - MIN) } else { y1 = clamp(y1 + dy, y0 + MIN, 1.0) },
    }
    Crop { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/// `imageEditView` {width, height, edit?, op?, …}: the editor after one step on a picture `width` × `height` (its
/// original's size): `turnLeft` (a quarter to the left, the crop turning with it), `mirror`, `straighten` {degrees,
/// -45 to 45}, `format` {format: free, 16:9, original, 4:3, square; the largest crop of it in the middle}, `corner`
/// {corner: nw, ne, sw, se, dx, dy, format} and `move` {dx, dy} (fractions of the frame, kept inside it), `reset`.
/// Answers the `edit`, the turned `frame`'s size, the `edited` size, whether it is `none` (Klar then reverts to the
/// original), and the `formats` to offer.
pub fn view(a: &Obj) -> R<Value> {
    let (w, h) = (a.get("width").and_then(Value::as_f64).ok_or("invalid-args")?, a.get("height").and_then(Value::as_f64).ok_or("invalid-args")?);
    let mut e = a.get("edit").filter(|e| e.is_object() && e["crop"].is_object()).cloned().unwrap_or_else(no_edit);
    let num = |k: &str| a.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let (fw, fh) = turned(w, h, rotate_of(&e));
    let format = a.get("format").and_then(Value::as_str).unwrap_or("free");
    match a.get("op").and_then(Value::as_str) {
        None => {}
        Some("turnLeft") => {
            let c = crop_of(&e);
            e["rotate"] = json!((rotate_of(&e) + 270) % 360);
            e["crop"] = crop_json(Crop { x: c.y, y: 1.0 - c.x - c.w, w: c.h, h: c.w });
        }
        Some("mirror") => {
            let c = crop_of(&e);
            e["flip"] = json!(!e["flip"].as_bool().unwrap_or(false));
            e["crop"] = crop_json(Crop { x: 1.0 - c.x - c.w, ..c });
        }
        Some("straighten") => e["straighten"] = json!(clamp(num("degrees"), -45.0, 45.0)),
        Some("format") => e["crop"] = crop_json(crop_of_aspect(aspect_of(format, w, h), fw, fh)),
        Some("corner") => {
            let corner = a.get("corner").and_then(Value::as_str).ok_or("invalid-args")?;
            e["crop"] = crop_json(drag_corner(crop_of(&e), corner, num("dx"), num("dy"), aspect_of(format, w, h), fw / fh));
        }
        Some("move") => {
            let c = crop_of(&e);
            e["crop"] = crop_json(Crop { x: clamp(c.x + num("dx"), 0.0, 1.0 - c.w), y: clamp(c.y + num("dy"), 0.0, 1.0 - c.h), ..c });
        }
        Some("reset") => e = no_edit(),
        _ => return Err("invalid-args".into()),
    }
    let (fw, fh) = turned(w, h, rotate_of(&e));
    let (ew, eh) = edited(w, h, &e);
    let formats = json!([{ "id": "free", "text": "imageEditor.free" }, { "id": "16:9", "name": "16:9" }, { "id": "original", "text": "imageEditor.originalFormat" },
                         { "id": "4:3", "name": "4:3" }, { "id": "square", "text": "imageEditor.square" }]);
    Ok(json!({ "edit": e, "frame": { "width": fw, "height": fh }, "edited": { "width": ew, "height": eh }, "none": is_no_edit(&e), "formats": formats }))
}

/// `imageDrawView` {width, height, edit, outWidth?, outHeight?, whole?}: how to draw the original (`width` × `height`)
/// edited onto a canvas `outWidth` × `outHeight`, y down, as the web's `drawEdited`: the `steps` to apply in order
/// (`scale` {x, y}, `translate` {x, y}, `rotate` {radians}), then the original drawn in `rect`. With `whole`, the whole
/// turned and straightened picture, uncut, as the editor shows it under its crop. Without an out size, the stored
/// sizes' (`sizes`: full within 1920 × 1080, thumb within 400 × 225, never larger than the edited picture).
pub fn draw(a: &Obj) -> R<Value> {
    let (w, h) = (a.get("width").and_then(Value::as_f64).ok_or("invalid-args")?, a.get("height").and_then(Value::as_f64).ok_or("invalid-args")?);
    let e = a.get("edit").filter(|e| e.is_object() && e["crop"].is_object()).cloned().unwrap_or_else(no_edit);
    let (ew, eh) = edited(w, h, &e);
    let fit = |mw: f64, mh: f64| { let s = 1f64.min(mw / ew).min(mh / eh); ((ew * s).round().max(1.0), (eh * s).round().max(1.0)) };
    let (full, thumb) = (fit(1920.0, 1080.0), fit(400.0, 225.0));
    let (ow, oh) = (a.get("outWidth").and_then(Value::as_f64).unwrap_or(full.0), a.get("outHeight").and_then(Value::as_f64).unwrap_or(full.1));
    let (fw, fh) = turned(w, h, rotate_of(&e));
    let c = if a.get("whole").and_then(Value::as_bool).unwrap_or(false) { Crop { x: 0.0, y: 0.0, w: 1.0, h: 1.0 } } else { crop_of(&e) };
    let degrees = e["straighten"].as_f64().unwrap_or(0.0);
    let g = grow(fw, fh, degrees);
    let flip = if e["flip"].as_bool().unwrap_or(false) { -1.0 } else { 1.0 };
    let steps = json!([
        { "op": "scale", "x": ow / (fw * c.w), "y": oh / (fh * c.h) },
        { "op": "translate", "x": -fw * c.x, "y": -fh * c.y },
        { "op": "translate", "x": fw / 2.0, "y": fh / 2.0 },
        { "op": "rotate", "radians": degrees.to_radians() },
        { "op": "scale", "x": g * flip, "y": g },
        { "op": "rotate", "radians": (rotate_of(&e) as f64).to_radians() },
    ]);
    Ok(json!({ "steps": steps, "rect": { "x": -w / 2.0, "y": -h / 2.0, "width": w, "height": h },
               "sizes": { "full": { "width": full.0, "height": full.1, "quality": 0.9 }, "thumb": { "width": thumb.0, "height": thumb.1, "quality": 0.8 } } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: Value) -> Obj { v.as_object().unwrap().clone() }

    #[test]
    fn turning_left_turns_the_frame_and_the_crop_with_it() {
        let v = view(&args(json!({ "width": 400, "height": 200, "edit": { "straighten": 0, "rotate": 0, "flip": false, "crop": { "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.6 } }, "op": "turnLeft" }))).unwrap();

        assert_eq!((v["edit"]["rotate"].clone(), v["frame"].clone()), (json!(270), json!({ "width": 200.0, "height": 400.0 })));
        assert_eq!(v["edit"]["crop"], json!({ "x": 0.2, "y": 0.4, "w": 0.6, "h": 0.5 }));
    }

    #[test]
    fn a_square_format_is_the_largest_square_in_the_middle() {
        let v = view(&args(json!({ "width": 400, "height": 200, "op": "format", "format": "square" }))).unwrap();

        assert_eq!(v["edit"]["crop"], json!({ "x": 0.25, "y": 0.0, "w": 0.5, "h": 1.0 }));
    }

    #[test]
    fn a_corner_keeps_the_crop_at_least_its_smallest_and_inside_the_picture() {
        let v = view(&args(json!({ "width": 400, "height": 200, "op": "corner", "corner": "se", "dx": -5, "dy": 5 }))).unwrap();

        let c = &v["edit"]["crop"];
        assert_eq!((c["w"].as_f64().unwrap(), c["h"].as_f64().unwrap()), (MIN, 1.0));
    }

    #[test]
    fn no_change_is_none_and_a_mirror_is_not() {
        let none = view(&args(json!({ "width": 10, "height": 10 }))).unwrap();
        let mirrored = view(&args(json!({ "width": 10, "height": 10, "op": "mirror" }))).unwrap();

        assert_eq!((none["none"].clone(), mirrored["none"].clone()), (json!(true), json!(false)));
    }

    #[test]
    fn straightening_grows_the_picture_so_no_corner_is_empty() {
        assert!((grow(1920.0, 1080.0, 10.0) - 1.2935).abs() < 0.001);
        assert_eq!(grow(100.0, 50.0, 0.0), 1.0);
    }

    #[test]
    fn the_stored_sizes_never_grow_past_the_edited_picture() {
        let d = draw(&args(json!({ "width": 600, "height": 400, "edit": { "straighten": 0, "rotate": 90, "flip": false, "crop": { "x": 0, "y": 0, "w": 1, "h": 0.5 } } }))).unwrap();

        assert_eq!((d["sizes"]["full"]["width"].clone(), d["sizes"]["full"]["height"].clone(), d["sizes"]["thumb"]["height"].clone()), (json!(400.0), json!(300.0), json!(225.0)));
    }
}
