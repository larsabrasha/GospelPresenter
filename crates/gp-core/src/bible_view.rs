// The Bible tab's reads (apps/web/src/pages/BibleTab.tsx): a translation's books, a book's chapters, a chapter's
// verses, and a passage's verses, each read from the stored book it needs (`bible_texts`, a row a book), never the whole
// translation, as the web read it at 238d481b (`bibleBooks`, then `chaptersOf`, `versesOf`, `versesInRange`).
use crate::args::*;
use crate::bridge::sql;
use crate::mutators::s;
use serde_json::{json, Value};

type StoredVerse = (i64, i64, String);

/// A book's verses as stored, `[[chapter, verse, text], …]`; none when the book is not in the text.
async fn verses_of(hash: &str, book: &str) -> Vec<StoredVerse> {
    let rows = sql("SELECT chunk FROM bible_texts WHERE hash = ? AND book = ?", vec![json!(hash), json!(book)]).await;
    rows.first().and_then(|r| r[0].as_str()).and_then(|c| serde_json::from_str(c).ok()).unwrap_or_default()
}

/// A `[chapter, verse]` of a passage's bounds.
fn point(v: &Value) -> R<(i64, i64)> {
    match v.as_array().map(Vec::as_slice) {
        Some([c, v]) => Ok((c.as_i64().ok_or("invalid-args")?, v.as_i64().ok_or("invalid-args")?)),
        _ => Err("invalid-args".into()),
    }
}

/// `bibleView` {hash, book?, chapter?, passage?: {books, from, to}}: null when this database does not have the text;
/// else its books' codes in stored order, with `book` its chapters, with `chapter` that chapter's verses
/// (`[chapter, verse, text]`), and with `passage` the verses from `from` to `to` inclusive (`[chapter, verse]`) in
/// each of `books`, in stored order, as `{b, c, v, t}`.
pub async fn view(a: &Obj) -> R<Value> {
    let hash = a.get("hash").and_then(Value::as_str).ok_or("invalid-args")?;
    let books: Vec<String> = sql("SELECT book FROM bible_texts WHERE hash = ? ORDER BY sort", vec![json!(hash)]).await.iter().map(|r| s(&r[0])).collect();
    if books.is_empty() { return Ok(Value::Null) }
    let mut out = json!({ "books": books });
    if let Some(book) = a.get("book").and_then(Value::as_str) {
        let verses = verses_of(hash, book).await;
        let mut chapters: Vec<i64> = Vec::new();
        for (c, _, _) in &verses { if !chapters.contains(c) { chapters.push(*c) } }
        out["chapters"] = json!(chapters);
        if let Some(chapter) = a.get("chapter").and_then(Value::as_i64) {
            out["verses"] = json!(verses.iter().filter(|(c, _, _)| *c == chapter).collect::<Vec<_>>());
        }
    }
    if let Some(p) = a.get("passage").filter(|p| !p.is_null()) {
        let wanted: Vec<&str> = p["books"].as_array().ok_or("invalid-args")?.iter().filter_map(Value::as_str).collect();
        let (from, to) = (point(&p["from"])?, point(&p["to"])?);
        let mut passage = Vec::new();
        for book in books.iter().filter(|b| wanted.contains(&b.as_str())) {
            for (c, v, t) in verses_of(hash, book).await {
                if (c, v) >= from && (c, v) <= to { passage.push(json!({ "b": book, "c": c, "v": v, "t": t })) }
            }
        }
        out["passage"] = json!(passage);
    }
    Ok(out)
}
