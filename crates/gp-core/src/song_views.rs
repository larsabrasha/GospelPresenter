// The songs list and its search (apps/web's Songs page, the add dialog's song tab): the library as rows, and the search
// of it (search.rs, SONG-R30–R33) over a library the core prepares once and keeps until the shell prepares it again,
// as the web's worker kept it (packages/sync's song-search.ts). The list's order is the shell's: by name in its
// language (Intl.Collator), which it hands the core with the library to prepare.
use crate::args::*;
use crate::bridge::sql;
use crate::rows::{columns, map, SONG};
use crate::search;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    /// The library as search reads it, in the shell's order: each song's id and prepared texts.
    static LIBRARY: RefCell<Option<(Vec<String>, Vec<search::Prepared>)>> = const { RefCell::new(None) };
}

/// `songsView`: the library without the trash, as rows in the table's order (`listSongs` before its stable sort by
/// name, so songs of one name keep that order).
pub async fn songs() -> R<Value> {
    Ok(Value::Array(sql(&format!("SELECT {} FROM songs WHERE deleted_at IS NULL", columns(SONG)), vec![]).await
        .iter().map(|r| map(r, SONG)).collect()))
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
