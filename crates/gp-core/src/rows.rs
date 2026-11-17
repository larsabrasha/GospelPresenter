// A row of the local database as the web's reads gave it (apps/web/src/db/queries.ts): SQLite's columns, snake_case,
// mapped to the core's row types, camelCase, each field converted as the web's mapper converts it.
use crate::json::js_number;
use serde_json::{json, Map, Value};

/// How a field is read: `String(x)`, `Number(x)`, `Boolean(x)`, or `x ?? null` (kept as it is).
#[derive(Clone, Copy)]
pub enum K { Str, Num, Bool, Opt }

/// `String(x)`: a text as it is, a number as JavaScript prints it, null as "null".
pub fn js_string(v: &Value) -> Value {
    match v {
        Value::String(_) => v.clone(),
        Value::Number(n) => json!(js_number(n.as_f64().unwrap_or(0.0))),
        Value::Bool(b) => json!(b.to_string()),
        _ => json!("null"),
    }
}

/// `Number(x)`: a number as it is, null as 0, a text read as a number (NaN, which JSON writes as null, otherwise).
fn js_num(v: &Value) -> Value {
    match v {
        Value::Number(_) => v.clone(),
        Value::Null => json!(0),
        Value::Bool(b) => json!(*b as i64),
        Value::String(s) => s.trim().parse::<f64>().map_or(Value::Null, |f| if f.fract() == 0.0 && f.abs() < 9e15 { json!(f as i64) } else { json!(f) }),
        _ => Value::Null,
    }
}

/// `Boolean(x)`.
fn js_bool(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// A row, its columns in `fields`' order, as an object of those fields.
pub fn map(row: &[Value], fields: &[(&str, K)]) -> Value {
    let mut out = Map::new();
    for ((key, kind), v) in fields.iter().zip(row) {
        let value = match kind { K::Str => js_string(v), K::Num => js_num(v), K::Bool => json!(js_bool(v)), K::Opt => v.clone() };
        out.insert((*key).into(), value);
    }
    Value::Object(out)
}

/// The columns of `fields`, snake_case, for a SELECT in their order.
pub fn columns(fields: &[(&str, K)]) -> String {
    fields.iter().map(|(k, _)| k.chars().flat_map(|c| if c.is_ascii_uppercase() { vec!['_', c.to_ascii_lowercase()] } else { vec![c] }).collect::<String>())
        .collect::<Vec<_>>().join(", ")
}

/// `Song`.
pub const SONG: &[(&str, K)] = &[("id", K::Str), ("name", K::Str), ("author", K::Opt), ("publisher", K::Opt), ("year", K::Opt), ("ccli", K::Opt), ("deletedAt", K::Opt)];
/// `Presentation`.
pub const PRESENTATION: &[(&str, K)] = &[("id", K::Str), ("name", K::Str), ("eventDate", K::Opt), ("deletedAt", K::Opt), ("themeId", K::Opt), ("isTemplate", K::Bool),
    ("weekday", K::Opt), ("time", K::Opt), ("location", K::Opt), ("description", K::Opt), ("updatedAt", K::Opt), ("lastUsedAt", K::Opt)];
/// `PresentationItem`; its type is read by `item`.
pub const ITEM: &[(&str, K)] = &[("id", K::Str), ("presentationId", K::Str), ("type", K::Opt), ("title", K::Str), ("sourceId", K::Str), ("sort", K::Num),
    ("arrangementId", K::Opt), ("content", K::Opt), ("overlayId", K::Opt), ("note", K::Opt)];
/// `SongArrangement`.
pub const ARRANGEMENT: &[(&str, K)] = &[("id", K::Str), ("songId", K::Str), ("name", K::Opt), ("partIds", K::Str), ("sort", K::Num)];

/// `Overlay`, but its `imageId`, always null.
pub const OVERLAY: &[(&str, K)] = &[("id", K::Str), ("title", K::Str), ("content", K::Opt), ("sort", K::Num), ("updatedAt", K::Opt)];

/// An item's type as the web reads it: an unknown one reads as a song.
pub fn item_kind(v: &Value) -> Value {
    let known = ["bible", "image", "audio", "video", "custom", "header"];
    json!(v.as_str().filter(|t| known.contains(t)).unwrap_or("song"))
}

/// A presentation item.
pub fn item(row: &[Value]) -> Value {
    let mut v = map(row, ITEM);
    v["type"] = item_kind(&v["type"]);
    v
}
