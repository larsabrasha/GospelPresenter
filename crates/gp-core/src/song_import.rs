// Which songs of a ProPresenter import share a name with one in the library or earlier in the import, and what the
// importer may choose for each (spec 02 "Import card", SONG-R42 as changed on 2026-10-31; the web's songImport.ts at
// fb03e798, proved against it by parity/views/song-import.mjs). The songs' ids and the mutation stay the shell's.
use crate::args::{is_js_space, js_trim, Obj, R};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

/// How two song names compare for duplicates: case and composition aside (SONG-R42).
fn name_key(name: &str) -> String { js_trim(name).nfc().collect::<String>().to_lowercase() }

/// The same words in the same order: spaces, line breaks and blank lines do not count.
fn same_text(a: &str, b: &str) -> bool { spaced(a) == spaced(b) }

/// Every run of JavaScript's white space as one space, trimmed (`replace(/\s+/g, ' ').trim()`).
fn spaced(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if is_js_space(c) { if !in_space { out.push(' ') } in_space = true } else { out.push(c); in_space = false }
    }
    js_trim(&out).to_string()
}

fn str_of<'a>(v: &'a Value, k: &str) -> &'a str { v.get(k).and_then(Value::as_str).unwrap_or("") }
fn list<'a>(a: &'a Obj, k: &str) -> R<&'a Vec<Value>> { a.get(k).and_then(Value::as_array).ok_or_else(|| "invalid-args".into()) }

/// `songNamesakesView` {names, library: string[]}: the places in `library` of the names one of `names` has.
pub fn namesakes(a: &Obj) -> R<Value> {
    let keys: Vec<String> = list(a, "names")?.iter().filter_map(Value::as_str).map(name_key).collect();
    let at: Vec<usize> = list(a, "library")?.iter().enumerate().filter(|(_, n)| keys.contains(&name_key(n.as_str().unwrap_or("")))).map(|(i, _)| i).collect();
    Ok(json!(at))
}

/// `songImportDuplicatesView` {songs: {name, text}[], library: {id, name, text}[]}: each song that shares a name, in file
/// order: its index, the song it is compared with (the library's with the same text, else the first; or one earlier in
/// the import, with no id), whether their text is the same, the choices it offers (replacing only a library song) and
/// the one it starts with (a same text skipped, another kept beside, so no text is lost).
pub fn duplicates(a: &Obj) -> R<Value> {
    type Seen = Vec<(String, Vec<(Value, String)>)>;
    fn add(seen: &mut Seen, key: String, entry: (Value, String)) {
        match seen.iter_mut().find(|(k, _)| *k == key) { Some((_, xs)) => xs.push(entry), None => seen.push((key, vec![entry])) }
    }
    // An id as JavaScript tests it: a library song's, not none or empty.
    let truthy = |id: &Value| !matches!(id, Value::Null | Value::Bool(false)) && id.as_str() != Some("") && id.as_f64() != Some(0.0);
    let mut seen: Seen = Vec::new();
    for s in list(a, "library")? { add(&mut seen, name_key(str_of(s, "name")), (s["id"].clone(), str_of(s, "text").to_string())) }
    let mut out = Vec::new();
    for (index, s) in list(a, "songs")?.iter().enumerate() {
        let (key, text) = (name_key(str_of(s, "name")), str_of(s, "text"));
        let others = seen.iter().find(|(k, _)| *k == key).map(|(_, xs)| xs.clone()).unwrap_or_default();
        if let Some((id, other)) = others.iter().find(|(_, t)| same_text(t, text)).or(others.first()) {
            let same = same_text(other, text);
            let choices: &[&str] = if truthy(id) { &["skip", "replace", "keep"] } else { &["skip", "keep"] };
            out.push(json!({ "index": index, "other": { "id": id, "text": other }, "same": same, "choices": choices, "choice": if same { "skip" } else { "keep" } }));
        }
        add(&mut seen, key, (Value::Null, text.to_string()));
    }
    Ok(Value::Array(out))
}
