// packages/core/src/mutators/arrangements.ts: a song's arrangements and the chips in them, edited as they are where
// the edit runs, so quick edits in a row and edits from two devices compose.
use super::*;
use super::history::{keep_song_version, keep_version_of_arrangement};
use super::songs::{part_ids_in_order, ARRANGEMENTS_LIMIT};
use crate::json::string_list;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createArrangement" => create(a, ctx).await,
        "updateArrangement" => update(a, ctx).await,
        "appendArrangementPart" => append_part(a, ctx).await,
        "removeArrangementPart" => remove_part(a, ctx).await,
        "moveArrangementPart" => move_part(a, ctx).await,
        "removeArrangement" => remove(a, ctx).await,
        _ => return None,
    })
}

/// The ids that are parts of the song, in the given order with repeats.
async fn own_part_ids(song_id: &str, part_ids: &[String]) -> Vec<String> {
    let own = part_ids_in_order(song_id).await;
    part_ids.iter().filter(|p| own.contains(p)).cloned().collect()
}

async fn create(a: &Obj, ctx: &Ctx) -> R<()> {
    let (xid, sid, name, part_ids) = (id(a, "id")?, id(a, "songId")?, opt_text(a, "name", 100)?, ids(a, "partIds", 500)?);
    require(ctx, "ManageSongs")?;
    if !found("SELECT id FROM songs WHERE id = ?", vec![json!(sid)]).await { return Err("not-found".into()) }
    let n = first(sql("SELECT count(*), max(sort) FROM song_arrangements WHERE song_id = ?", vec![json!(sid)]).await).unwrap();
    limit(int_of(&n[0]) >= ARRANGEMENTS_LIMIT as i64)?;
    keep_song_version(&sid, ctx, false).await;
    let ids = string_list(&own_part_ids(&sid, &part_ids).await);
    let sort = if n[1].is_null() { 0 } else { int_of(&n[1]) + 1 };
    sql("INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        vec![json!(xid), json!(sid), json!(name), json!(ids), json!(sort)]).await;
    Ok(())
}

async fn update(a: &Obj, ctx: &Ctx) -> R<()> {
    let xid = id(a, "id")?;
    let name = field(a, "name", |o, k| opt_text(o, k, 100))?;
    let part_ids = if a.contains_key("partIds") { Some(ids(a, "partIds", 500)?) } else { None };
    require(ctx, "ManageSongs")?;
    let Some(x) = first(sql("SELECT song_id FROM song_arrangements WHERE id = ?", vec![json!(xid)]).await) else { return Ok(()) };
    let sid = s(&x[0]);
    let mut set: Vec<(&str, Value)> = Vec::new();
    if let Some(n) = name { set.push(("name", json!(n))) }
    if let Some(p) = part_ids { set.push(("part_ids", json!(string_list(&own_part_ids(&sid, &p).await)))) }
    if set.is_empty() { return Ok(()) }
    keep_song_version(&sid, ctx, false).await;
    update_set("song_arrangements", set, &xid).await;
    Ok(())
}

/// The arrangement's song and part ids where this runs, or None if it is gone.
async fn arrangement_parts(xid: &str) -> Option<(String, Vec<String>)> {
    first(sql("SELECT song_id, part_ids FROM song_arrangements WHERE id = ?", vec![json!(xid)]).await).map(|x| (s(&x[0]), parse_part_ids(&s(&x[1]))))
}

/// `chipAt`: `index` if it still holds `part`, else the nearest occurrence of `part` (the first of two as near).
fn chip_at(ids: &[String], index: usize, part: &str) -> Option<usize> {
    if ids.get(index).map(String::as_str) == Some(part) { return Some(index) }
    let mut best: Option<usize> = None;
    for (i, x) in ids.iter().enumerate() {
        if x == part && best.is_none_or(|b| i.abs_diff(index) < b.abs_diff(index)) { best = Some(i) }
    }
    best
}

async fn set_parts(song_id: &str, xid: &str, ids: &[String], ctx: &Ctx) {
    keep_song_version(song_id, ctx, false).await;
    sql("UPDATE song_arrangements SET part_ids = ? WHERE id = ?", vec![json!(string_list(ids)), json!(xid)]).await;
}

async fn append_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let (xid, part) = (id(a, "id")?, id(a, "partId")?);
    require(ctx, "ManageSongs")?;
    let Some((sid, mut ids)) = arrangement_parts(&xid).await else { return Ok(()) };
    if own_part_ids(&sid, std::slice::from_ref(&part)).await.is_empty() { return Ok(()) }
    limit(ids.len() >= 500)?;
    ids.push(part);
    set_parts(&sid, &xid, &ids, ctx).await;
    Ok(())
}

async fn remove_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let (xid, at, part) = (id(a, "id")?, index(a, "index")?, id(a, "partId")?);
    require(ctx, "ManageSongs")?;
    let Some((sid, mut ids)) = arrangement_parts(&xid).await else { return Ok(()) };
    if let Some(i) = chip_at(&ids, at, &part) {
        ids.remove(i);
        set_parts(&sid, &xid, &ids, ctx).await;
    }
    Ok(())
}

async fn move_part(a: &Obj, ctx: &Ctx) -> R<()> {
    let (xid, at, part, by) = (id(a, "id")?, index(a, "index")?, id(a, "partId")?, int(a, "by", -500, 500)?);
    require(ctx, "ManageSongs")?;
    let Some((sid, mut ids)) = arrangement_parts(&xid).await else { return Ok(()) };
    let Some(from) = chip_at(&ids, at, &part) else { return Ok(()) };
    let to = (from as i64 + by).min(ids.len() as i64 - 1).max(0) as usize;
    if to != from {
        ids.remove(from);
        ids.insert(to, part);
        set_parts(&sid, &xid, &ids, ctx).await;
    }
    Ok(())
}

async fn remove(a: &Obj, ctx: &Ctx) -> R<()> {
    let xid = id(a, "id")?;
    require(ctx, "ManageSongs")?;
    keep_version_of_arrangement(&xid, ctx).await;
    sql("DELETE FROM song_arrangements WHERE id = ?", vec![json!(xid)]).await;
    Ok(())
}
