// packages/core/src/mutators/songs.ts: songs, their parts, and the import of songs read from ProPresenter files.
use super::*;
use super::history::{keep_song_version, keep_version_of_part};
use super::labels::ensure_label;
use crate::json::string_list;

const SONGS: i64 = 5000;
const PARTS_PER_SONG: i64 = 50;
const ARRANGEMENTS_PER_SONG: usize = 10;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createSong" => create_song(a, ctx).await,
        "updateSong" => update_song(a, ctx).await,
        "trashSong" => set_deleted(a, ctx, true).await,
        "restoreSong" => set_deleted(a, ctx, false).await,
        "purgeSong" => purge_song(a, ctx).await,
        "addSongPart" => add_song_part(a, ctx).await,
        "updateSongPart" => update_song_part(a, ctx).await,
        "removeSongPart" => remove_song_part(a, ctx).await,
        "moveSongPart" => move_song_part(a, ctx).await,
        "importSongs" => crate::mutators::song_import::import_songs(a, ctx).await,
        _ => return None,
    })
}

async fn live_songs() -> i64 { int_of(&first(sql("SELECT count(*) FROM songs WHERE deleted_at IS NULL", vec![]).await).unwrap()[0]) }

async fn create_song(a: &Obj, ctx: &Ctx) -> R<()> {
    let (sid, name, author) = (id(a, "id")?, name(a, "name")?, opt_text(a, "author", 200)?);
    require(ctx, "ManageSongs")?;
    limit(live_songs().await >= SONGS)?;
    sql("INSERT INTO songs (id, name, author) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", vec![json!(sid), json!(name), json!(author)]).await;
    Ok(())
}

/// `z.number().int().min(0).max(9999).nullable()`.
fn opt_year(o: &Obj, k: &str) -> R<Option<i64>> {
    match o.get(k) { None | Some(Value::Null) => Ok(None), Some(_) => int(o, k, 0, 9999).map(Some) }
}

async fn update_song(a: &Obj, ctx: &Ctx) -> R<()> {
    let sid = id(a, "id")?;
    let name = opt_name(a, "name")?;
    let author = field(a, "author", |o, k| opt_text(o, k, 200))?;
    let publisher = field(a, "publisher", |o, k| opt_text(o, k, 200))?;
    let year = field(a, "year", opt_year)?;
    let ccli = field(a, "ccli", |o, k| opt_text(o, k, 20))?;
    require(ctx, "ManageSongs")?;
    let mut set: Vec<(&str, Value)> = Vec::new();
    if let Some(n) = &name { set.push(("name", json!(n))) }
    for (col, v) in [("author", author), ("publisher", publisher), ("ccli", ccli)] {
        if let Some(v) = v { set.push((col, json!(v))) }
    }
    if let Some(y) = year { set.push(("year", json!(y))) }
    if set.is_empty() { return Ok(()) }
    keep_song_version(&sid, ctx, false).await;
    update_set("songs", set, &sid).await;
    if let Some(n) = name { rename_song_items(&sid, &n).await }
    Ok(())
}

/// `renameSongItems`: a renamed song's items, in presentations and templates, take its new name.
pub async fn rename_song_items(song_id: &str, name: &str) {
    sql("UPDATE presentation_items SET title = ? WHERE type = 'song' AND source_id = ? AND title <> ?", vec![json!(name), json!(song_id), json!(name)]).await;
}

async fn set_deleted(a: &Obj, ctx: &Ctx, trash: bool) -> R<()> {
    let sid = id(a, "id")?;
    let at = if trash { json!(safe_int(a, "at")?) } else { Value::Null };
    require(ctx, "ManageSongs")?;
    sql("UPDATE songs SET deleted_at = ? WHERE id = ?", vec![at, json!(sid)]).await;
    Ok(())
}

/// `deleteSongRows`: a song with its material, history, arrangements and parts; items that use it stay.
pub async fn delete_song_rows(song_id: &str) {
    for table in ["song_materials", "song_versions", "song_arrangements", "song_parts"] {
        sql(&format!("DELETE FROM {table} WHERE song_id = ?"), vec![json!(song_id)]).await;
    }
    sql("DELETE FROM songs WHERE id = ?", vec![json!(song_id)]).await;
}

async fn purge_song(a: &Obj, ctx: &Ctx) -> R<()> {
    let sid = id(a, "id")?;
    require(ctx, "ManageSongs")?;
    let Some(row) = first(sql("SELECT deleted_at FROM songs WHERE id = ?", vec![json!(sid)]).await) else { return Ok(()) };
    if row[0].is_null() { return Err("not-in-trash".into()) }
    delete_song_rows(&sid).await;
    Ok(())
}

pub async fn part_ids_in_order(song_id: &str) -> Vec<String> {
    ids_of("SELECT id FROM song_parts WHERE song_id = ? ORDER BY sort ASC, id ASC", vec![json!(song_id)]).await
}

async fn renumber_parts(order: &[String]) {
    for (i, pid) in order.iter().enumerate() {
        sql("UPDATE song_parts SET sort = ? WHERE id = ? AND sort <> ?", vec![json!(i), json!(pid), json!(i)]).await;
    }
}

/// `partContent`: at most 5 000 characters, as it is.
pub fn part_content(o: &Obj, k: &str) -> R<String> {
    match o.get(k) { Some(Value::String(c)) if c.chars().count() <= 5000 => Ok(c.clone()), _ => Err("invalid-args".into()) }
}

/// `labelText`: trimmed, at most 50, or null; it must be given.
pub fn label_text(o: &Obj, k: &str) -> R<Option<String>> {
    match o.get(k) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(t)) if js_trim(t).chars().count() <= 50 => Ok(Some(js_trim(t).to_string())),
        _ => Err("invalid-args".into()),
    }
}

async fn add_song_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let (pid, sid, label, content) = (id(a, "id")?, id(a, "songId")?, label_text(a, "labelText")?, part_content(a, "content")?);
    require(ctx, "ManageSongs")?;
    if !found("SELECT id FROM songs WHERE id = ?", vec![json!(sid)]).await { return Err("not-found".into()) }
    let n = int_of(&first(sql("SELECT count(*) FROM song_parts WHERE song_id = ?", vec![json!(sid)]).await).unwrap()[0]);
    limit(n >= PARTS_PER_SONG)?;
    keep_song_version(&sid, ctx, false).await;
    let top = first(sql("SELECT max(sort) FROM song_parts WHERE song_id = ?", vec![json!(sid)]).await).unwrap();
    let sort = if top[0].is_null() { 0 } else { int_of(&top[0]) + 1 };
    let label = ensure_label(label.as_deref()).await;
    sql("INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        vec![json!(pid), json!(sid), json!(sort), json!(label), json!(content)]).await;
    Ok(())
}

async fn update_song_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let pid = id(a, "id")?;
    let content = if a.contains_key("content") { Some(part_content(a, "content")?) } else { None };
    let label = if a.contains_key("labelText") { Some(label_text(a, "labelText")?) } else { None };
    require(ctx, "ManageSongs")?;
    let mut set: Vec<(&str, Value)> = Vec::new();
    if let Some(c) = content { set.push(("content", json!(c))) }
    if let Some(l) = label { set.push(("label_id", json!(ensure_label(l.as_deref()).await))) }
    if set.is_empty() { return Ok(()) }
    keep_version_of_part(&pid, ctx).await;
    update_set("song_parts", set, &pid).await;
    Ok(())
}

async fn remove_song_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let pid = id(a, "id")?;
    require(ctx, "ManageSongs")?;
    let Some(p) = first(sql("SELECT song_id FROM song_parts WHERE id = ?", vec![json!(pid)]).await) else { return Ok(()) };
    let sid = s(&p[0]);
    keep_song_version(&sid, ctx, false).await;
    sql("DELETE FROM song_parts WHERE id = ?", vec![json!(pid)]).await;
    renumber_parts(&part_ids_in_order(&sid).await).await;
    for x in sql("SELECT id, part_ids FROM song_arrangements WHERE song_id = ?", vec![json!(sid)]).await {
        let ids = parse_part_ids(&s(&x[1]));
        if ids.contains(&pid) {
            let kept: Vec<String> = ids.into_iter().filter(|i| *i != pid).collect();
            sql("UPDATE song_arrangements SET part_ids = ? WHERE id = ?", vec![json!(string_list(&kept)), x[0].clone()]).await;
        }
    }
    Ok(())
}

async fn move_song_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let (pid, to) = (id(a, "id")?, index(a, "toIndex")?);
    require(ctx, "ManageSongs")?;
    let Some(p) = first(sql("SELECT song_id FROM song_parts WHERE id = ?", vec![json!(pid)]).await) else { return Ok(()) };
    let sid = s(&p[0]);
    keep_song_version(&sid, ctx, false).await;
    let mut order: Vec<String> = part_ids_in_order(&sid).await.into_iter().filter(|x| *x != pid).collect();
    order.insert(to.min(order.len()), pid);
    renumber_parts(&order).await;
    Ok(())
}

pub const PARTS_LIMIT: usize = PARTS_PER_SONG as usize;
pub const ARRANGEMENTS_LIMIT: usize = ARRANGEMENTS_PER_SONG;
pub const SONGS_LIMIT: i64 = SONGS;
