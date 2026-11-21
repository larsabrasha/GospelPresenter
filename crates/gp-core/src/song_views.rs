// The songs list and its search (apps/web's Songs page, the add dialog's song tab): the library as rows, and the search
// of it (search.rs, SONG-R30–R33) over a library the core prepares once and keeps until the shell prepares it again,
// as the web's worker kept it (packages/sync's song-search.ts). The list's order is the shell's: by name in its
// language (Intl.Collator), which it hands the core with the library to prepare.
use crate::args::*;
use crate::bridge::sql;
use crate::collation::{lang, sort, Key};
use crate::rows::{columns, map, SONG};
use crate::search;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    /// The library as search reads it, in the shell's order: each song's id and prepared texts.
    static LIBRARY: RefCell<Option<(Vec<String>, Vec<search::Prepared>)>> = const { RefCell::new(None) };
}

/// `songsView` {locale}: the library without the trash, by name in the page's language; songs of one name in the
/// table's order (`listSongs`).
pub async fn songs(a: &Obj) -> R<Value> {
    let mut rows: Vec<Value> = sql(&format!("SELECT {} FROM songs WHERE deleted_at IS NULL", columns(SONG)), vec![]).await.iter().map(|r| map(r, SONG)).collect();
    sort(lang(a), &mut rows, &[Key::Name("name")]);
    Ok(Value::Array(rows))
}

/// The section a name goes under (songLetters.ts's `letterOf`): its first letter in capitals, Å, Ä and Ö their own;
/// "#" for a digit or a sign.
fn letter_of(name: &str) -> String {
    match name.trim().chars().next() {
        Some(c) if c.is_alphabetic() => c.to_uppercase().collect(),
        _ => "#".into(),
    }
}

/// The songs from which a sectioned list has its letter index (the web's ui/Library.tsx `INDEX_FROM`).
const INDEX_FROM: usize = 20;

/// `songListView` {sort, locale}: Sånger as its page lists it (the web's Songs.tsx): `sorts` (by name, the default, or
/// by author, those without one last and then by name), the `sort` chosen, and the songs in `sections`: by name in runs
/// by first letter, each letter once where its first song is (as Contacts has them), by author in one section
/// without a letter; `index`: whether a touch screen shows the letters along the list's edge (the web's LetterIndex,
/// from `INDEX_FROM` songs in sections).
pub async fn song_list(a: &Obj) -> R<Value> {
    let l = lang(a);
    let mut rows = songs(a).await?.as_array().cloned().unwrap_or_default();
    let by_author = a.get("sort").and_then(Value::as_str) == Some("author");
    let sorts = json!([{ "id": "name", "text": "library.sort.name" }, { "id": "author", "text": "library.sort.author" }]);
    if by_author {
        let author = |r: &Value| r["author"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| "\u{ffff}".into());
        rows.sort_by(|x, y| crate::collation::ids(l, &author(x), &author(y)).then_with(|| crate::collation::ids(l, x["name"].as_str().unwrap_or(""), y["name"].as_str().unwrap_or(""))));
        return Ok(json!({ "sorts": sorts, "sort": "author", "sections": [{ "letter": null, "rows": rows }], "index": false }));
    }
    let index = rows.len() >= INDEX_FROM;
    let mut sections: Vec<Value> = Vec::new();
    for r in rows {
        let letter = letter_of(r["name"].as_str().unwrap_or(""));
        match sections.iter_mut().find(|s| s["letter"] == letter.as_str()) {
            Some(s) => s["rows"].as_array_mut().unwrap().push(r),
            None => sections.push(json!({ "letter": letter, "rows": [r] })),
        }
    }
    Ok(json!({ "sorts": sorts, "sort": "name", "sections": sections, "index": index }))
}

/// `songSearchPrepare` {order}: reads the library and prepares it for search, in `order` (the songs' ids as the shell
/// orders them; ties in a search keep it). A song not in `order` is not searched.
pub async fn prepare(a: &Obj) -> R<Value> {
    let order: Vec<String> = a.get("order").and_then(Value::as_array).ok_or("invalid-args")?
        .iter().map(|v| v.as_str().map(String::from).ok_or_else(|| "invalid-args".to_string())).collect::<R<_>>()?;
    let songs: HashMap<String, (String, String)> = sql("SELECT id, name, author FROM songs WHERE deleted_at IS NULL", vec![]).await.into_iter()
        .map(|r| (s(&r[0]), (s(&r[1]), s(&r[2])))).collect();
    let mut lyrics: HashMap<String, Vec<String>> = HashMap::new();
    for r in sql("SELECT p.song_id, p.content FROM song_parts p JOIN songs s ON s.id = p.song_id WHERE s.deleted_at IS NULL ORDER BY p.song_id, p.sort, p.id", vec![]).await {
        lyrics.entry(s(&r[0])).or_default().push(s(&r[1]));
    }
    let mut ids = Vec::with_capacity(order.len());
    let mut prepared = Vec::with_capacity(order.len());
    for id in order {
        let Some((name, author)) = songs.get(&id) else { continue };
        let own = lyrics.get(&id).map(Vec::as_slice).unwrap_or(&[]);
        prepared.push(search::prepare(name, author, own.first().map_or("", String::as_str), &own.join("\n")));
        ids.push(id);
    }
    let n = ids.len();
    LIBRARY.with(|l| *l.borrow_mut() = Some((ids, prepared)));
    Ok(json!(n))
}

/// `songSearchView` {query}: the ids of the songs that match, best first, ties in the library's order; every song for
/// a blank query. Refused as `not-prepared` until the library is (a new instance of the core holds none).
pub fn search_view(a: &Obj) -> R<Value> {
    let query = a.get("query").and_then(Value::as_str).unwrap_or("");
    LIBRARY.with(|l| match &*l.borrow() {
        Some((ids, prepared)) => Ok(Value::Array(search::rank(prepared, query).into_iter().map(|i| json!(ids[i])).collect())),
        None => Err("not-prepared".into()),
    })
}

fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }
