// packages/core/src/themes.ts's `themeDefinitionSchema`: a theme of the organisation's own, checked as zod checks it and
// given back in zod's order; and the blobs of its pictures (`themeBlobs`).
use crate::args::*;
use crate::json::J;
use crate::pages::{enum_j, num};
use serde_json::Value;

fn bad<T>() -> R<T> { Err("invalid-args".into()) }
fn int_j(o: &Obj, k: &str, lo: i64, hi: i64) -> R<J> { int(o, k, lo, hi).map(|i| J::Num(i as f64)) }

fn field<'a>(o: &'a Obj, k: &str) -> R<&'a Obj> { o.get(k).map_or_else(bad, obj) }

/// `cssColor`: 1–60 of `/^[#a-z0-9(),.%\s]+$/i`.
fn css_color(o: &Obj, k: &str) -> R<J> {
    let ok = |c: char| c.is_ascii_alphanumeric() || "#(),.%".contains(c) || is_js_space(c);
    match o.get(k) { Some(Value::String(c)) if (1..=60).contains(&c.chars().count()) && c.chars().all(ok) => Ok(J::str(c)), _ => bad() }
}

/// `/^[\w\s',-]+$/`, 1–200.
fn font_family(o: &Obj, k: &str) -> R<J> {
    let ok = |c: char| c.is_ascii_alphanumeric() || "_',-".contains(c) || is_js_space(c);
    match o.get(k) { Some(Value::String(f)) if (1..=200).contains(&f.chars().count()) && f.chars().all(ok) => Ok(J::str(f)), _ => bad() }
}

fn area(o: &Obj) -> R<J> {
    Ok(J::obj(vec![("x", int_j(o, "x", 0, 1880)?), ("y", int_j(o, "y", 0, 1040)?), ("w", int_j(o, "w", 40, 1920)?), ("h", int_j(o, "h", 40, 1080)?)]))
}

fn text_style(o: &Obj) -> R<J> {
    let flag = |k: &str| boolean(o, k).map(J::Bool);
    Ok(J::obj(vec![
        ("fontSize", int_j(o, "fontSize", 10, 300)?), ("fontFamily", font_family(o, "fontFamily")?), ("fontWeight", int_j(o, "fontWeight", 100, 900)?),
        ("lineHeight", num(o, "lineHeight", 0.8, 3.0)?), ("color", css_color(o, "color")?), ("align", enum_j(o, "align", &["left", "center", "right"])?),
        ("shadow", flag("shadow")?), ("uppercase", flag("uppercase")?), ("outline", int_j(o, "outline", 0, 20)?), ("outlineColor", css_color(o, "outlineColor")?),
        ("area", area(field(o, "area")?)?), ("valign", enum_j(o, "valign", &["top", "middle", "bottom"])?),
    ]))
}

/// `/^[a-z0-9-]+\/[a-z0-9-]+$/`.
fn asset(s: &str) -> bool {
    let part = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    s.split_once('/').is_some_and(|(a, b)| part(a) && part(b))
}

fn image(v: &Value, blobs: &mut Vec<String>) -> R<J> {
    let o = obj(v)?;
    match o.get("kind").and_then(Value::as_str) {
        Some("builtIn") => match o.get("asset") { Some(Value::String(a)) if asset(a) => Ok(J::obj(vec![("kind", J::str("builtIn")), ("asset", J::str(a))])), _ => bad() },
        Some("picture") => {
            let (full, thumb) = (media_hash(o, "full")?, media_hash(o, "thumb")?);
            blobs.extend([full.clone(), thumb.clone()]);
            Ok(J::obj(vec![("kind", J::str("picture")), ("full", J::Str(full)), ("thumb", J::Str(thumb))]))
        }
        _ => bad(),
    }
}

fn background(o: &Obj, blobs: &mut Vec<String>) -> R<J> {
    let img = match o.get("image") { Some(Value::Null) => J::Null, Some(v) => image(v, blobs)?, None => return bad() };
    Ok(J::obj(vec![("color", css_color(o, "color")?), ("image", img), ("fit", enum_j(o, "fit", &["cover", "contain"])?), ("scrim", int_j(o, "scrim", 0, 100)?)]))
}

fn slide_style(o: &Obj, blobs: &mut Vec<String>) -> R<J> {
    Ok(J::obj(vec![("background", background(field(o, "background")?, blobs)?), ("main", text_style(field(o, "main")?)?), ("credits", text_style(field(o, "credits")?)?)]))
}

/// A definition, and the blobs of its pictures in `themeBlobs`'s order: the song's background, the Bible's, media's.
pub fn definition(v: Option<&Value>) -> R<(J, Vec<String>)> {
    let o = v.map_or_else(bad, obj)?;
    let mut blobs = Vec::new();
    let song = slide_style(field(o, "song")?, &mut blobs)?;
    let bible = slide_style(field(o, "bible")?, &mut blobs)?;
    let media = background(field(o, "media")?, &mut blobs)?;
    Ok((J::obj(vec![("song", song), ("bible", bible), ("media", media)]), blobs))
}
