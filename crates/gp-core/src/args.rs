// The argument schemas of packages/core's presentation mutators (zod there), written out by hand.
use serde_json::{Map, Value};

pub type Obj = Map<String, Value>;
pub type R<T> = Result<T, String>;

fn bad<T>() -> R<T> { Err("invalid-args".into()) }

/** String.prototype.trim: its white space is not Rust's (it takes U+FEFF, and leaves U+0085). */
pub fn js_trim(s: &str) -> &str { s.trim_matches(is_js_space) }

/** JavaScript's white space, as `trim` and `\\s` take it. */
pub fn is_js_space(c: char) -> bool {
    matches!(c, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub fn obj(v: &Value) -> R<&Obj> { v.as_object().ok_or_else(|| "invalid-args".to_string()) }

fn id_value(v: &Value) -> R<String> {
    match v { Value::String(s) if (1..=100).contains(&s.chars().count()) => Ok(s.clone()), _ => bad() }
}

/** `id`: 1–100 characters. */
pub fn id(o: &Obj, k: &str) -> R<String> { o.get(k).map_or_else(bad, id_value) }

/** `id.nullable().optional()`. */
pub fn opt_id(o: &Obj, k: &str) -> R<Option<String>> {
    match o.get(k) { None | Some(Value::Null) => Ok(None), Some(v) => id_value(v).map(Some) }
}

/** `z.string().trim().min(min).max(max)`. */
pub fn trimmed(o: &Obj, k: &str, min: usize, max: usize) -> R<String> {
    match o.get(k) {
        Some(Value::String(s)) => { let t = js_trim(s); if (min..=max).contains(&t.chars().count()) { Ok(t.to_string()) } else { bad() } }
        _ => bad(),
    }
}

/** `name`: trimmed, 1–200 characters. */
pub fn name(o: &Obj, k: &str) -> R<String> { trimmed(o, k, 1, 200) }

/** `labelKey` (labels.ts): a label's text as compared, case and spacing aside. */
pub fn label_key(text: &str) -> String {
    js_trim(text).to_lowercase().split(is_js_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/** `optionalText(max).optional()`: trimmed, blank as null. */
pub fn opt_text(o: &Obj, k: &str, max: usize) -> R<Option<String>> {
    match o.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => { let t = js_trim(s); if t.chars().count() > max { bad() } else if t.is_empty() { Ok(None) } else { Ok(Some(t.to_string())) } }
        _ => bad(),
    }
}

fn digits(s: &str) -> bool { s.bytes().all(|b| b.is_ascii_digit()) }

/** `HH:MM`. */
pub fn opt_time(o: &Obj, k: &str) -> R<Option<String>> {
    match o.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let b = s.as_bytes();
            let ok = b.len() == 5 && b[2] == b':' && digits(&s[..2]) && digits(&s[3..]) && s[..2].parse::<u32>().unwrap() < 24 && s[3..].parse::<u32>().unwrap() < 60;
            if ok { Ok(Some(s.clone())) } else { bad() }
        }
        _ => bad(),
    }
}

/** `z.iso.date()`: YYYY-MM-DD, a day the month has. */
pub fn opt_date(o: &Obj, k: &str) -> R<Option<String>> {
    match o.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let b = s.as_bytes();
            if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !digits(&s[..4]) || !digits(&s[5..7]) || !digits(&s[8..]) { return bad(); }
            let (y, m, d): (u32, u32, u32) = (s[..4].parse().unwrap(), s[5..7].parse().unwrap(), s[8..].parse().unwrap());
            let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
            let days = match m { 1 | 3 | 5 | 7 | 8 | 10 | 12 => 31, 4 | 6 | 9 | 11 => 30, 2 => if leap { 29 } else { 28 }, _ => 0 };
            if d >= 1 && d <= days { Ok(Some(s.clone())) } else { bad() }
        }
        _ => bad(),
    }
}

/** `z.number().int().min(lo).max(hi)`. */
pub fn int(o: &Obj, k: &str, lo: i64, hi: i64) -> R<i64> {
    match o.get(k).and_then(|v| v.as_f64()) {
        Some(f) if f.fract() == 0.0 && f >= lo as f64 && f <= hi as f64 => Ok(f as i64),
        _ => bad(),
    }
}

/** `z.array(id).max(max)`. */
pub fn ids(o: &Obj, k: &str, max: usize) -> R<Vec<String>> {
    match o.get(k) {
        Some(Value::Array(a)) if a.len() <= max => a.iter().map(id_value).collect(),
        _ => bad(),
    }
}

/** A field of an update: None when absent (left as it is), Some(value) when given, a null clearing it. */
pub fn field<T>(o: &Obj, k: &str, f: impl Fn(&Obj, &str) -> R<Option<T>>) -> R<Option<Option<T>>> {
    if o.contains_key(k) { f(o, k).map(Some) } else { Ok(None) }
}

/** `name.optional()`: absent, or a valid name; null is refused. */
pub fn opt_name(o: &Obj, k: &str) -> R<Option<String>> {
    if o.contains_key(k) { name(o, k).map(Some) } else { Ok(None) }
}

/** `optionalText(max)`, which must be given (null allowed). */
pub fn text_given(o: &Obj, k: &str, max: usize) -> R<Option<String>> {
    if o.contains_key(k) { opt_text(o, k, max) } else { bad() }
}

/** `id.nullable()`, which must be given. */
pub fn id_or_null(o: &Obj, k: &str) -> R<Option<String>> {
    if o.contains_key(k) { opt_id(o, k) } else { bad() }
}

/** `z.number().int()`: a safe integer. */
pub fn safe_int(o: &Obj, k: &str) -> R<i64> { int(o, k, -(2i64.pow(53) - 1), 2i64.pow(53) - 1) }
