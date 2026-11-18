// JSON as JavaScript holds it, for rewriting JSON text another app wrote (the export zip's rows and pages,
// legacy.rs) so that what is written back is what JSON.stringify would write: JSON.parse's grammar, an object's keys
// in JavaScript's order (array indexes first, ascending, then the others as put; a key put again keeps its place),
// and String() of a value. serde_json's Map would sort the keys.
use crate::json::{js_number, J};
use serde_json::{Map, Value};

pub type Fields = Vec<(String, J)>;

/// `JSON.parse`, or None where it would throw. Half a UTF-16 pair in an escape is U+FFFD.
pub fn parse(text: &str) -> Option<J> {
    let mut p = Parser { s: text.as_bytes(), i: 0 };
    p.space();
    let v = p.value()?;
    p.space();
    (p.i == p.s.len()).then_some(v)
}

struct Parser<'a> { s: &'a [u8], i: usize }

impl Parser<'_> {
    fn space(&mut self) { while matches!(self.s.get(self.i), Some(b' ' | b'\t' | b'\n' | b'\r')) { self.i += 1 } }
    fn eat(&mut self, word: &str) -> bool {
        let ok = self.s[self.i..].starts_with(word.as_bytes());
        if ok { self.i += word.len() }
        ok
    }
    fn value(&mut self) -> Option<J> {
        match *self.s.get(self.i)? {
            b'{' => {
                self.i += 1;
                let mut fields = Fields::new();
                self.space();
                if self.eat("}") { return Some(J::Obj(fields)) }
                loop {
                    self.space();
                    if self.s.get(self.i) != Some(&b'"') { return None }
                    let key = self.string()?;
                    self.space();
                    if !self.eat(":") { return None }
                    self.space();
                    let v = self.value()?;
                    set(&mut fields, &key, v);
                    self.space();
                    if self.eat("}") { return Some(J::Obj(fields)) }
                    if !self.eat(",") { return None }
                }
            }
            b'[' => {
                self.i += 1;
                let mut xs = Vec::new();
                self.space();
                if self.eat("]") { return Some(J::Arr(xs)) }
                loop {
                    self.space();
                    xs.push(self.value()?);
                    self.space();
                    if self.eat("]") { return Some(J::Arr(xs)) }
                    if !self.eat(",") { return None }
                }
            }
            b'"' => self.string().map(J::Str),
            b't' => self.eat("true").then_some(J::Bool(true)),
            b'f' => self.eat("false").then_some(J::Bool(false)),
            b'n' => self.eat("null").then_some(J::Null),
            _ => self.number(),
        }
    }
    /// `-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`
    fn number(&mut self) -> Option<J> {
        let start = self.i;
        let digits = |p: &mut Self| { let from = p.i; while p.s.get(p.i).is_some_and(u8::is_ascii_digit) { p.i += 1 } p.i - from };
        if self.s.get(self.i) == Some(&b'-') { self.i += 1 }
        match self.s.get(self.i) { Some(b'0') => self.i += 1, Some(b'1'..=b'9') => { digits(self); } _ => return None }
        if self.s.get(self.i) == Some(&b'.') { self.i += 1; if digits(self) == 0 { return None } }
        if matches!(self.s.get(self.i), Some(b'e' | b'E')) {
            self.i += 1;
            if matches!(self.s.get(self.i), Some(b'+' | b'-')) { self.i += 1 }
            if digits(self) == 0 { return None }
        }
        std::str::from_utf8(&self.s[start..self.i]).ok()?.parse::<f64>().ok().map(J::Num)
    }
    fn string(&mut self) -> Option<String> {
        self.i += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            let c = *self.s.get(self.i)?;
            match c {
                b'"' => { self.i += 1; return Some(String::from_utf16_lossy(&units)) }
                b'\\' => {
                    let e = *self.s.get(self.i + 1)?;
                    self.i += 2;
                    let u = match e {
                        b'"' => 0x22, b'\\' => 0x5c, b'/' => 0x2f, b'b' => 0x08, b'f' => 0x0c, b'n' => 0x0a, b'r' => 0x0d, b't' => 0x09,
                        b'u' => {
                            let hex = std::str::from_utf8(self.s.get(self.i..self.i + 4)?).ok()?;
                            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) { return None }
                            self.i += 4;
                            u16::from_str_radix(hex, 16).ok()?
                        }
                        _ => return None,
                    };
                    units.push(u);
                }
                0..=0x1f => return None,
                _ => {
                    // A whole UTF-8 character, its units as JavaScript's string has them.
                    let len = match c { 0..=0x7f => 1, 0xc0..=0xdf => 2, 0xe0..=0xef => 3, _ => 4 };
                    let ch = std::str::from_utf8(self.s.get(self.i..self.i + len)?).ok()?;
                    units.extend(ch.encode_utf16());
                    self.i += len;
                }
            }
        }
    }
}

/// An array index as JavaScript orders an object's keys by: "0", or no leading zero, at most 2³² − 2.
fn index(key: &str) -> Option<u64> {
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) || (key.len() > 1 && key.starts_with('0')) { return None }
    key.parse::<u64>().ok().filter(|&n| n <= 4_294_967_294)
}

/// `o[key] = v`: in place where the key is, else among the indexes in their order, else last.
pub fn set(fields: &mut Fields, key: &str, v: J) {
    if let Some(f) = fields.iter_mut().find(|(k, _)| k == key) { f.1 = v; return }
    let at = match index(key) {
        Some(n) => fields.iter().position(|(k, _)| index(k).is_none_or(|m| m > n)).unwrap_or(fields.len()),
        None => fields.len(),
    };
    fields.insert(at, (key.to_string(), v));
}

pub fn get<'a>(fields: &'a Fields, key: &str) -> Option<&'a J> { fields.iter().find(|(k, _)| k == key).map(|(_, v)| v) }

/// `delete o[key]`, giving what it held.
pub fn take(fields: &mut Fields, key: &str) -> Option<J> { fields.iter().position(|(k, _)| k == key).map(|i| fields.remove(i).1) }

/// `a ?? b`: a when it is there and not null.
pub fn given(v: Option<&J>) -> Option<&J> { v.filter(|v| !matches!(v, J::Null)) }

/// `typeof v === 'string' ? v : null`.
pub fn text(v: Option<&J>) -> Option<&str> { match v { Some(J::Str(s)) => Some(s), _ => None } }

/// `String(v)`; a value not there is "undefined".
pub fn js_string(v: Option<&J>) -> String {
    match v {
        None => "undefined".into(),
        Some(J::Null) => "null".into(),
        Some(J::Bool(b)) => b.to_string(),
        Some(J::Num(n)) => js_number(*n),
        Some(J::Str(s)) => s.clone(),
        Some(J::Arr(xs)) => xs.iter().map(|x| if matches!(x, J::Null) { String::new() } else { js_string(Some(x)) }).collect::<Vec<_>>().join(","),
        Some(J::Obj(_)) => "[object Object]".into(),
    }
}

/// The same value as serde_json's, for the schemas that check one (their order is the schema's).
pub fn value(v: &J) -> Value {
    match v {
        J::Null => Value::Null,
        J::Bool(b) => Value::Bool(*b),
        J::Num(n) => serde_json::Number::from_f64(*n).map_or(Value::Null, Value::Number),
        J::Str(s) => Value::String(s.clone()),
        J::Arr(xs) => Value::Array(xs.iter().map(value).collect()),
        J::Obj(fields) => Value::Object(fields.iter().map(|(k, v)| (k.clone(), value(v))).collect::<Map<_, _>>()),
    }
}

impl Clone for J {
    fn clone(&self) -> J {
        match self {
            J::Null => J::Null,
            J::Bool(b) => J::Bool(*b),
            J::Num(n) => J::Num(*n),
            J::Str(s) => J::Str(s.clone()),
            J::Arr(xs) => J::Arr(xs.clone()),
            J::Obj(fields) => J::Obj(fields.clone()),
        }
    }
}

impl PartialEq for J {
    /// SameValueZero on what JSON holds: numbers and strings by value, an array or an object never equal to another.
    fn eq(&self, other: &J) -> bool {
        match (self, other) {
            (J::Null, J::Null) => true,
            (J::Bool(a), J::Bool(b)) => a == b,
            (J::Num(a), J::Num(b)) => a == b,
            (J::Str(a), J::Str(b)) => a == b,
            _ => false,
        }
    }
}
