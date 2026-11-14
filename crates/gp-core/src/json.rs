// JSON as JavaScript's JSON.stringify writes it: keys in the order they were put (zod's output is in its schema's
// order), numbers as JavaScript prints them. What the core stores as JSON text must be the TS core's, byte for byte.
use serde_json::Value;

pub enum J {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

/// A number as JavaScript prints it: -0 as 0, whole numbers without a point, an exponent below 1e-6 and from 1e21.
pub fn js_number(f: f64) -> String {
    if f == 0.0 { return "0".into() }
    let a = f.abs();
    if !(1e-6..1e21).contains(&a) {
        let e = format!("{f:e}");
        return if a >= 1e21 { e.replace('e', "e+") } else { e };
    }
    if f.fract() == 0.0 { format!("{f:.0}") } else { format!("{f}") }
}

impl J {
    pub fn str(s: &str) -> J { J::Str(s.to_string()) }
    pub fn opt(s: Option<String>) -> J { s.map_or(J::Null, J::Str) }
    pub fn obj(fields: Vec<(&str, J)>) -> J { J::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect()) }

    pub fn stringify(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            J::Null => out.push_str("null"),
            J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            J::Num(f) => out.push_str(&js_number(*f)),
            J::Str(s) => out.push_str(&serde_json::to_string(s).unwrap()),
            J::Arr(xs) => {
                out.push('[');
                for (i, x) in xs.iter().enumerate() {
                    if i > 0 { out.push(',') }
                    x.write(out);
                }
                out.push(']');
            }
            J::Obj(fields) => {
                out.push('{');
                for (i, (k, v)) in fields.iter().enumerate() {
                    if i > 0 { out.push(',') }
                    out.push_str(&serde_json::to_string(k).unwrap());
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }

    /// A value read from SQLite or the arguments, as it is (objects in serde_json's order: only for flat values).
    pub fn of(v: &Value) -> J {
        match v {
            Value::Null => J::Null,
            Value::Bool(b) => J::Bool(*b),
            Value::Number(n) => J::Num(n.as_f64().unwrap_or(0.0)),
            Value::String(s) => J::str(s),
            Value::Array(a) => J::Arr(a.iter().map(J::of).collect()),
            Value::Object(o) => J::Obj(o.iter().map(|(k, v)| (k.clone(), J::of(v))).collect()),
        }
    }
}

/// `JSON.stringify` of a list of strings.
pub fn string_list(xs: &[String]) -> String { J::Arr(xs.iter().map(|x| J::str(x)).collect()).stringify() }
