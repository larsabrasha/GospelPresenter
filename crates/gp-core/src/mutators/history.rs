// packages/core/src/mutators/history.ts: song history. Before the server runs a change to a song it keeps the song as
// it was, whole; a restore brings back its fields, its parts with their ids and its arrangements.
use super::*;
use super::labels::ensure_label;
use crate::json::{js_number, string_list, J};

const SONG_VERSION_LIMIT: usize = 50;
const SONG_VERSION_WINDOW_MS: f64 = 30.0 * 60.0 * 1000.0;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "restoreSongVersion" => restore_song_version(a, ctx).await,
        _ => return None,
    })
}

/// `snapshotOf`: the song as it is where this runs, as the JSON a version keeps, and whether it has parts.
async fn snapshot_of(song_id: &str) -> Option<(String, String, bool)> {
    let song = first(sql("SELECT name, author, publisher, year, ccli FROM songs WHERE id = ?", vec![json!(song_id)]).await)?;
    let parts = sql("SELECT p.id, p.label_id, l.text, l.color, p.content FROM song_parts p LEFT JOIN labels l ON l.id = p.label_id
                     WHERE p.song_id = ? ORDER BY p.sort ASC, p.id ASC", vec![json!(song_id)]).await;
    let arrangements = sql("SELECT id, name, part_ids FROM song_arrangements WHERE song_id = ? ORDER BY sort ASC, id ASC", vec![json!(song_id)]).await;
    let has_parts = !parts.is_empty();
    let parts = parts.iter().map(|p| J::obj(vec![("id", J::of(&p[0])), ("labelId", J::of(&p[1])), ("labelText", J::of(&p[2])), ("labelColor", J::of(&p[3])), ("content", J::of(&p[4]))]));
    let arrangements = arrangements.iter().map(|x| {
        let ids = parse_part_ids(&s(&x[2])).into_iter().map(J::Str).collect();
        J::obj(vec![("id", J::of(&x[0])), ("name", J::of(&x[1])), ("partIds", J::Arr(ids))])
    });
    let data = J::obj(vec![
        ("name", J::of(&song[0])), ("author", J::of(&song[1])), ("publisher", J::of(&song[2])), ("year", J::of(&song[3])), ("ccli", J::of(&song[4])),
        ("parts", J::Arr(parts.collect())), ("arrangements", J::Arr(arrangements.collect())),
    ]);
    Some((s(&song[0]), data.stringify(), has_parts))
}

/// `keepSongVersion`: on the server only (`ctx.now`), none of a song with no parts, none when the newest version is
/// the same song, or, unless `always`, when the same person made it within the window.
pub async fn keep_song_version(song_id: &str, ctx: &Ctx, always: bool) {
    let Some(now) = ctx.now else { return };
    let Some((name, data, has_parts)) = snapshot_of(song_id).await else { return };
    if !has_parts { return }
    let newest = first(sql("SELECT user_id, created_at, data FROM song_versions WHERE song_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", vec![json!(song_id)]).await);
    if let Some(n) = &newest {
        if s(&n[2]) == data { return }
        if !always && s(&n[0]) == ctx.user_id && now - n[1].as_f64().unwrap_or(0.0) < SONG_VERSION_WINDOW_MS { return }
    }
    let base = format!("{song_id}@{}", js_number(now));
    let mut version_id = base.clone();
    let mut n = 2;
    while found("SELECT id FROM song_versions WHERE id = ?", vec![json!(version_id)]).await {
        version_id = format!("{base}:{n}");
        n += 1;
    }
    sql("INSERT INTO song_versions (id, song_id, user_id, created_at, name, data) VALUES (?, ?, ?, ?, ?, ?)",
        vec![json!(version_id), json!(song_id), json!(ctx.user_id), changed_at(ctx), json!(name), json!(data)]).await;
    let kept = ids_of("SELECT id FROM song_versions WHERE song_id = ? ORDER BY created_at DESC, id DESC", vec![json!(song_id)]).await;
    for v in kept.iter().skip(SONG_VERSION_LIMIT) {
        sql("DELETE FROM song_versions WHERE id = ?", vec![json!(v)]).await;
    }
}

/// `keepVersionOfPart`.
pub async fn keep_version_of_part(part_id: &str, ctx: &Ctx) {
    if ctx.now.is_none() { return }
    if let Some(p) = first(sql("SELECT song_id FROM song_parts WHERE id = ?", vec![json!(part_id)]).await) { keep_song_version(&s(&p[0]), ctx, false).await }
}

/// `keepVersionOfArrangement`.
pub async fn keep_version_of_arrangement(arrangement_id: &str, ctx: &Ctx) {
    if ctx.now.is_none() { return }
    if let Some(x) = first(sql("SELECT song_id FROM song_arrangements WHERE id = ?", vec![json!(arrangement_id)]).await) { keep_song_version(&s(&x[0]), ctx, false).await }
}

/// A version's text as `snapshotSchema` reads it; None where it does not.
struct Snapshot { name: String, author: Value, publisher: Value, year: Value, ccli: Value, parts: Vec<SnapPart>, arrangements: Vec<(String, Value, Vec<String>)> }
struct SnapPart { id: String, label_id: Option<String>, label_text: Option<String>, content: String }

fn parse_snapshot(data: &str) -> Option<Snapshot> {
    let v: Value = serde_json::from_str(data).ok()?;
    let str_or_null = |x: &Value| -> Option<Value> { if x.is_string() || x.is_null() { Some(x.clone()) } else { None } };
    let strs = |x: &Value| -> Option<Vec<String>> { x.as_array()?.iter().map(|i| i.as_str().map(String::from)).collect() };
    let parts = v["parts"].as_array()?.iter().map(|p| Some(SnapPart {
        id: p["id"].as_str()?.into(),
        label_id: str_or_null(&p["labelId"])?.as_str().map(String::from),
        label_text: str_or_null(&p["labelText"])?.as_str().map(String::from),
        content: { str_or_null(&p["labelColor"])?; p["content"].as_str()?.into() },
    })).collect::<Option<Vec<_>>>()?;
    let arrangements = v["arrangements"].as_array()?.iter().map(|x| Some((x["id"].as_str()?.to_string(), str_or_null(&x["name"])?, strs(&x["partIds"])?))).collect::<Option<Vec<_>>>()?;
    let year = if v["year"].is_number() || v["year"].is_null() { v["year"].clone() } else { return None };
    Some(Snapshot { name: v["name"].as_str()?.into(), author: str_or_null(&v["author"])?, publisher: str_or_null(&v["publisher"])?, year, ccli: str_or_null(&v["ccli"])?, parts, arrangements })
}

/// A part's label on restore: the label it had if that is still there, else one with its text.
async fn label_for(part: &SnapPart) -> Option<String> {
    if let Some(lid) = part.label_id.as_ref().filter(|l| !l.is_empty()) {
        if found("SELECT id FROM labels WHERE id = ?", vec![json!(lid)]).await { return Some(lid.clone()) }
    }
    ensure_label(part.label_text.as_deref()).await
}

/// "Återställ version": keeps the song as it is now, then gives it the version's fields, parts and arrangements.
async fn restore_song_version(a: &Obj, ctx: &Ctx) -> R<()> {
    let song_id = id(a, "songId")?;
    let version_id = match a.get("versionId") { Some(Value::String(v)) if (1..=200).contains(&v.chars().count()) => v.clone(), _ => return Err("invalid-args".into()) };
    require(ctx, "ManageSongs")?;
    let v = first(sql("SELECT data FROM song_versions WHERE id = ? AND song_id = ?", vec![json!(version_id), json!(song_id)]).await).ok_or("not-found")?;
    if !found("SELECT id FROM songs WHERE id = ?", vec![json!(song_id)]).await { return Err("not-found".into()) }
    keep_song_version(&song_id, ctx, true).await;
    let snap = parse_snapshot(&s(&v[0])).ok_or("invalid-snapshot")?;
    sql("UPDATE songs SET name = ?, author = ?, publisher = ?, year = ?, ccli = ? WHERE id = ?",
        vec![json!(snap.name), snap.author.clone(), snap.publisher.clone(), snap.year.clone(), snap.ccli.clone(), json!(song_id)]).await;
    super::songs::rename_song_items(&song_id, &snap.name).await;
    let part_ids: Vec<String> = snap.parts.iter().map(|p| p.id.clone()).collect();
    let arrangement_ids: Vec<String> = snap.arrangements.iter().map(|x| x.0.clone()).collect();
    sql("DELETE FROM song_arrangements WHERE song_id = ? AND id NOT IN (SELECT value FROM json_each(?))", vec![json!(song_id), json!(string_list(&arrangement_ids))]).await;
    sql("DELETE FROM song_parts WHERE song_id = ? AND id NOT IN (SELECT value FROM json_each(?))", vec![json!(song_id), json!(string_list(&part_ids))]).await;
    for (sort, p) in snap.parts.iter().enumerate() {
        let label = label_for(p).await;
        sql("INSERT INTO song_parts (id, song_id, sort, label_id, content) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET song_id = excluded.song_id, sort = excluded.sort, label_id = excluded.label_id, content = excluded.content",
            vec![json!(p.id), json!(song_id), json!(sort), json!(label), json!(p.content)]).await;
    }
    for (sort, (xid, name, ids)) in snap.arrangements.iter().enumerate() {
        let own: Vec<String> = ids.iter().filter(|p| part_ids.contains(p)).cloned().collect();
        sql("INSERT INTO song_arrangements (id, song_id, name, part_ids, sort) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET song_id = excluded.song_id, name = excluded.name, part_ids = excluded.part_ids, sort = excluded.sort",
            vec![json!(xid), json!(song_id), name.clone(), json!(string_list(&own)), json!(sort)]).await;
    }
    Ok(())
}
