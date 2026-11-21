// What a device does with Bible texts (docs/bibles-and-themes.md, "Bibles"; Lars, 2026-11-21): the web's
// syncBibleTexts, fetchBibleText and BibleTextUploads (packages/sync/src/client/bibles.ts at 3d061fc9) worked out in the
// core, so every shell fetches, checks, keeps, drops and uploads alike. A text is a translation's verses as one
// immutable JSON named by its SHA-256, kept a book a row (`bible_texts`) with a marker that it is whole
// (`bible_blobs`); only the `bibles` row syncs. The shell moves the bytes; the core says which texts and reads them.
use crate::args::*;
use crate::bridge::sql;
// JavaScript's `String(v)`, as the web named an import's `contentHash`.
use crate::media_plan::js_string;
use crate::mutators::{int_of, s};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

/// `BIBLE_LIMITS`: verses in a text (and a book), a verse's length in code points (as zod 4 counts a string's
/// `max`), books in a text.
const MAX_VERSES: usize = 60_000;
const MAX_VERSE_LENGTH: usize = 10_000;
const MAX_BOOKS: usize = 200;

/// The translations whose texts this device keeps: every one on a desktop host ('all'), else those chosen
/// ("Tillgänglig offline", `kept_bibles`).
fn kept(a: &Obj) -> &'static str {
    match a.get("keeping").and_then(Value::as_str) {
        Some("chosen") => "SELECT content_hash FROM bibles WHERE id IN (SELECT id FROM kept_bibles)",
        _ => "SELECT content_hash FROM bibles",
    }
}

/// The queued imports, each with its place in the queue, its id, its arguments and the text it names.
async fn imports() -> Vec<(usize, i64, Value, String)> {
    let rows = sql("SELECT id, name, args FROM _mutation ORDER BY id", vec![]).await;
    rows.iter().enumerate()
        .filter(|(_, r)| s(&r[1]) == "importBible")
        .map(|(i, r)| {
            let args: Value = serde_json::from_str(&s(&r[2])).unwrap_or(Value::Null);
            let hash = js_string(args.get("contentHash"));
            (i, int_of(&r[0]), args, hash)
        })
        .collect()
}

/// `bibleTextPlanView` {keeping}: the texts to fetch (a kept translation names them and they are not here, in the
/// order the web fetched them) and to drop (here and no kept translation names them, never one a queued import names).
pub async fn plan_view(a: &Obj) -> R<Value> {
    let kept = kept(a);
    let fetch: Vec<String> = sql(&format!("SELECT DISTINCT content_hash AS hash FROM ({kept}) WHERE content_hash NOT IN (SELECT hash FROM bible_blobs)"), vec![]).await
        .iter().map(|r| s(&r[0])).collect();
    let queued: HashSet<String> = imports().await.into_iter().map(|(_, _, _, h)| h).collect();
    let drop: Vec<String> = sql(&format!("SELECT hash FROM bible_blobs WHERE hash NOT IN ({kept})"), vec![]).await
        .iter().map(|r| s(&r[0])).filter(|h| !queued.contains(h)).collect();
    Ok(json!({ "fetch": fetch, "drop": drop }))
}

/// A whole number from 0 to 999, as `z.number().int().min(0).max(999)` takes it.
fn small(v: &Value) -> Option<i64> {
    let f = v.as_f64()?;
    (f.fract() == 0.0 && (0.0..=999.0).contains(&f)).then_some(f as i64)
}

/// `bibleBookTextSchema` of a book: its code and its verses' chunk, the JSON `bookChunk` writes, and how many.
fn book(b: &Value) -> Option<(String, String, usize)> {
    let code = b.get("code")?.as_str()?;
    if code.len() != 3 || !code.bytes().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase()) { return None }
    let verses = b.get("verses")?.as_array()?;
    if verses.is_empty() || verses.len() > MAX_VERSES { return None }
    let mut out = Vec::with_capacity(verses.len());
    for v in verses {
        let [c, n, t] = v.as_array()?.as_slice() else { return None };
        let t = t.as_str()?;
        if t.chars().count() > MAX_VERSE_LENGTH { return None }
        out.push(json!([small(c)?, small(n)?, t]));
    }
    Some((code.to_string(), Value::Array(out).to_string(), verses.len()))
}

/// `verified`: a text's books as stored ({code, chunk}) and its verses, if `json` reads as a text (`bibleTextSchema`)
/// whose canonical JSON (`serializeBibleText`) is what `hash` names.
fn read_text(json: &str, hash: &str) -> Option<(Vec<(String, String)>, usize)> {
    let text: Value = serde_json::from_str(json).ok()?;
    if text.get("v").and_then(Value::as_f64) != Some(1.0) { return None }
    let books = text.get("books")?.as_array()?;
    if books.is_empty() || books.len() > MAX_BOOKS { return None }
    let mut out = Vec::with_capacity(books.len());
    let mut codes = HashSet::new();
    let mut verses = 0;
    for b in books {
        let (code, chunk, n) = book(b)?;
        if !codes.insert(code.clone()) { return None }
        verses += n;
        out.push((code, chunk));
    }
    if verses > MAX_VERSES || sha256_hex(&join(&out)) != hash { return None }
    Some((out, verses))
}

/// `joinBibleText`: the canonical JSON of a text from its books' chunks.
fn join(books: &[(String, String)]) -> String {
    let parts: Vec<String> = books.iter().map(|(code, chunk)| format!("{{\"code\":{},\"verses\":{chunk}}}", Value::String(code.clone()))).collect();
    format!("{{\"v\":1,\"books\":[{}]}}", parts.join(","))
}

/// `bibleImportTextView` {data (the zip, base64)}: an import as a shell keeps and records it (the web worker's
/// importBible: `readBibleZip`, `serializeBibleText`, `bibleTextHash`, `bibleId`): the translation's `name`,
/// `abbreviation`, `language` and `verses`, its `id`, and its text's canonical `json` and its `hash`, which
/// `bibleTextStoreView` keeps and `importBible` names; refused as `bibleImportView` refuses.
pub fn import_text_view(a: &Obj) -> R<Value> {
    let bible = crate::bible_import::view(a)?;
    let books: Vec<(String, String, usize)> = bible["books"].as_array().ok_or("no-verses")?.iter().map(|b| book(b).ok_or_else(|| "no-verses".to_string())).collect::<R<_>>()?;
    let verses: usize = books.iter().map(|b| b.2).sum();
    let json = join(&books.into_iter().map(|(c, k, _)| (c, k)).collect::<Vec<_>>());
    let abbreviation = bible["abbreviation"].as_str().unwrap_or("");
    let id = format!("bible:{}", crate::args::js_trim(&unicode_nfc(abbreviation)).to_lowercase());
    Ok(json!({ "name": bible["name"], "abbreviation": abbreviation, "language": bible["language"], "verses": verses, "id": id,
               "hash": sha256_hex(&json), "json": json }))
}

/// NFC, as JavaScript's `normalize('NFC')`.
fn unicode_nfc(s: &str) -> String { unicode_normalization::UnicodeNormalization::nfc(s).collect() }

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// `bibleTextStoreView` {hash, json}: the statements that keep a text fetched from the server (`storeBibleTextSql`:
/// a row a book, then its marker), or null when it does not read as a text or is not what `hash` names.
pub fn store_view(a: &Obj) -> R<Value> {
    let hash = a.get("hash").and_then(Value::as_str).unwrap_or_default();
    let json = a.get("json").and_then(Value::as_str).unwrap_or_default();
    let Some((books, verses)) = read_text(json, hash) else { return Ok(json!({ "store": null })) };
    let mut store: Vec<Value> = books.into_iter().enumerate()
        .map(|(i, (code, chunk))| json!({ "sql": "INSERT OR REPLACE INTO bible_texts (hash, book, sort, chunk) VALUES (?, ?, ?, ?)", "params": [hash, code, i, chunk] }))
        .collect();
    store.push(json!({ "sql": "INSERT OR REPLACE INTO bible_blobs (hash, verse_count) VALUES (?, ?)", "params": [hash, verses] }));
    Ok(json!({ "store": store }))
}

/// `bibleTextJsonView` {hash}: a kept text's canonical JSON, exactly as hashed (`storedTextJson`), or null if this
/// device does not have it.
pub async fn json_view(a: &Obj) -> R<Value> {
    let hash = a.get("hash").and_then(Value::as_str).unwrap_or_default();
    if sql("SELECT 1 FROM bible_blobs WHERE hash = ?", vec![json!(hash)]).await.is_empty() { return Ok(json!({ "json": null })) }
    let books: Vec<(String, String)> = sql("SELECT book, chunk FROM bible_texts WHERE hash = ? ORDER BY sort", vec![json!(hash)]).await
        .iter().map(|r| (s(&r[0]), s(&r[1]))).collect();
    Ok(json!({ "json": join(&books) }))
}

/// `bibleUploadsView` {uploaded: [hash]}: the texts to upload before a push (`BibleTextUploads.beforePush`), each
/// queued import with its place in the queue, its id and arguments (a refused one is queued again from them) and the
/// text it names, but those already uploaded. An upload that cannot reach the server holds back that import and all
/// after it: the push's limit is its place.
pub async fn uploads_view(a: &Obj) -> R<Value> {
    let uploaded: HashSet<String> = a.get("uploaded").and_then(Value::as_array).into_iter().flatten().map(|h| js_string(Some(h))).collect();
    let out: Vec<Value> = imports().await.into_iter()
        .map(|(index, id, args, hash)| json!({ "index": index, "id": id, "args": args, "hash": hash, "uploaded": uploaded.contains(&hash) }))
        .collect();
    Ok(json!({ "uploads": out }))
}

#[cfg(test)]
#[path = "bible_texts_tests.rs"]
mod tests;
