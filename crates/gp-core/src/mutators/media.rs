// packages/core/src/mutators/media.ts: the library of pictures, sounds and videos (this module), and the items of a
// running order that show them (`media_items`).
use super::*;
use crate::json::J;
use crate::pages::num;

const FILE_NAME: usize = 200;
const IMAGES: i64 = 1000;
const AUDIOS: i64 = 500;
const VIDEOS: i64 = 500;
const AUDIO_BYTES: i64 = 20 * 1024 * 1024;
const VIDEO_BYTES: i64 = 2 * 1024 * 1024 * 1024;
const AUDIO_TYPES: [&str; 6] = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm", "audio/x-m4a"];

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    const IMAGE_KIND: (&str, &str) = ("images", "ManageImages");
    const AUDIO_KIND: (&str, &str) = ("audios", "ManageAudios");
    const VIDEO_KIND: (&str, &str) = ("videos", "ManageVideos");
    Some(match name {
        "addImage" => add_image(a, ctx).await,
        "editImage" => edit_image(a, ctx).await,
        "revertImage" => revert_image(a, ctx).await,
        "addAudio" => add_audio(a, ctx).await,
        "addVideo" => add_video(a, ctx).await,
        // Each kind's four library changes (`libraryChanges`).
        "trashImage" => set_deleted(a, ctx, IMAGE_KIND, true).await,
        "restoreImage" => set_deleted(a, ctx, IMAGE_KIND, false).await,
        "renameImage" => rename(a, ctx, IMAGE_KIND).await,
        "purgeImage" => purge(a, ctx, IMAGE_KIND).await,
        "trashAudio" => set_deleted(a, ctx, AUDIO_KIND, true).await,
        "restoreAudio" => set_deleted(a, ctx, AUDIO_KIND, false).await,
        "renameAudio" => rename(a, ctx, AUDIO_KIND).await,
        "purgeAudio" => purge(a, ctx, AUDIO_KIND).await,
        "trashVideo" => set_deleted(a, ctx, VIDEO_KIND, true).await,
        "restoreVideo" => set_deleted(a, ctx, VIDEO_KIND, false).await,
        "renameVideo" => rename(a, ctx, VIDEO_KIND).await,
        "purgeVideo" => purge(a, ctx, VIDEO_KIND).await,
        _ => return super::media_items::run(name, a, ctx).await,
    })
}

fn file_name(a: &Obj) -> R<String> { trimmed(a, "fileName", 1, FILE_NAME) }

/// Every blob of `hashes` known where this runs, else `media-missing`.
async fn require_hashes(hashes: &[&String]) -> R<()> { require_blobs(&hashes.iter().map(|h| h.to_string()).collect::<Vec<_>>()).await }

async fn live(table: &str) -> i64 { int_of(&first(sql(&format!("SELECT count(*) FROM {table} WHERE deleted_at IS NULL"), vec![]).await).unwrap()[0]) }

async fn add_image(a: &Obj, ctx: &Ctx) -> R<()> {
    let (iid, name, kind) = (id(a, "id")?, file_name(a)?, one_of(a, "contentType", &["image/jpeg", "image/webp"])?);
    let (full, thumb) = (media_hash(a, "fullHash")?, media_hash(a, "thumbHash")?);
    let (width, height, created) = (int(a, "width", 1, 1920)?, int(a, "height", 1, 1080)?, safe_int(a, "createdAt")?);
    require(ctx, "ManageImages")?;
    if found("SELECT id FROM images WHERE id = ?", vec![json!(iid)]).await { return Ok(()) }
    require_hashes(&[&full, &thumb]).await?;
    limit(live("images").await >= IMAGES)?;
    sql("INSERT INTO images (id, file_name, content_type, full_hash, thumb_hash, width, height, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
        vec![json!(iid), json!(name), json!(kind), json!(full), json!(thumb), json!(width), json!(height), json!(created)]).await;
    Ok(())
}

/// `imageEditSchema`: straightened, turned, mirrored and cut, as JSON in zod's order.
fn image_edit(v: Option<&Value>) -> R<J> {
    let o = v.map_or_else(|| Err("invalid-args".to_string()), obj)?;
    let rotate = match o.get("rotate").and_then(Value::as_f64) { Some(r) if [0.0, 90.0, 180.0, 270.0].contains(&r) => J::Num(r), _ => return Err("invalid-args".into()) };
    let c = o.get("crop").map_or_else(|| Err("invalid-args".to_string()), obj)?;
    let positive = |k: &str| match c.get(k).and_then(Value::as_f64) { Some(f) if f > 0.0 && f <= 1.0 => Ok(f), _ => Err("invalid-args".to_string()) };
    let (x, y) = (c.get("x").and_then(Value::as_f64), c.get("y").and_then(Value::as_f64));
    let (Some(x), Some(y)) = (x.filter(|f| (0.0..=1.0).contains(f)), y.filter(|f| (0.0..=1.0).contains(f))) else { return Err("invalid-args".into()) };
    let (w, h) = (positive("w")?, positive("h")?);
    if !(x + w <= 1.0001 && y + h <= 1.0001) { return Err("invalid-args".into()) }
    let crop = J::obj(vec![("x", J::Num(x)), ("y", J::Num(y)), ("w", J::Num(w)), ("h", J::Num(h))]);
    Ok(J::obj(vec![("straighten", num(o, "straighten", -45.0, 45.0)?), ("rotate", rotate), ("flip", J::Bool(boolean(o, "flip")?)), ("crop", crop)]))
}

/// A picture edited: its first edit keeps what it was as the original; every edit after is made from that original.
async fn edit_image(a: &Obj, ctx: &Ctx) -> R<()> {
    let (iid, full, thumb) = (id(a, "id")?, media_hash(a, "fullHash")?, media_hash(a, "thumbHash")?);
    let (width, height, edit) = (int(a, "width", 1, 1920)?, int(a, "height", 1, 1080)?, image_edit(a.get("edit"))?);
    require(ctx, "ManageImages")?;
    let row = first(sql("SELECT full_hash, thumb_hash, width, height, original_full_hash FROM images WHERE id = ?", vec![json!(iid)]).await).ok_or("not-found")?;
    require_hashes(&[&full, &thumb]).await?;
    let mut set: Vec<(&str, Value)> = Vec::new();
    if row[4].as_str().is_none_or(str::is_empty) {
        set.extend([("original_full_hash", row[0].clone()), ("original_thumb_hash", row[1].clone()), ("original_width", row[2].clone()), ("original_height", row[3].clone())]);
    }
    set.extend([("full_hash", json!(full)), ("thumb_hash", json!(thumb)), ("width", json!(width)), ("height", json!(height)), ("edit", json!(edit.stringify()))]);
    update_set("images", set, &iid).await;
    Ok(())
}

/// The picture as it was imported again, however long ago it was edited; a picture never edited is left as it is.
async fn revert_image(a: &Obj, ctx: &Ctx) -> R<()> {
    let iid = id(a, "id")?;
    require(ctx, "ManageImages")?;
    let Some(row) = first(sql("SELECT original_full_hash, original_thumb_hash, original_width, original_height FROM images WHERE id = ?", vec![json!(iid)]).await) else { return Ok(()) };
    let text = |v: &Value| v.as_str().is_some_and(|s| !s.is_empty());
    let number = |v: &Value| v.as_f64().is_some_and(|n| n != 0.0);
    if !(text(&row[0]) && text(&row[1]) && number(&row[2]) && number(&row[3])) { return Ok(()) }
    sql("UPDATE images SET full_hash = ?, thumb_hash = ?, width = ?, height = ?, original_full_hash = NULL, original_thumb_hash = NULL,
         original_width = NULL, original_height = NULL, edit = NULL WHERE id = ?", vec![row[0].clone(), row[1].clone(), row[2].clone(), row[3].clone(), json!(iid)]).await;
    Ok(())
}

async fn set_deleted(a: &Obj, ctx: &Ctx, (table, permission): (&str, &str), trash: bool) -> R<()> {
    let fid = id(a, "id")?;
    let at = if trash { json!(safe_int(a, "at")?) } else { Value::Null };
    require(ctx, permission)?;
    sql(&format!("UPDATE {table} SET deleted_at = ? WHERE id = ?"), vec![at, json!(fid)]).await;
    Ok(())
}

async fn rename(a: &Obj, ctx: &Ctx, (table, permission): (&str, &str)) -> R<()> {
    let (fid, name) = (id(a, "id")?, file_name(a)?);
    require(ctx, permission)?;
    sql(&format!("UPDATE {table} SET file_name = ? WHERE id = ?"), vec![json!(name), json!(fid)]).await;
    Ok(())
}

async fn purge(a: &Obj, ctx: &Ctx, (table, permission): (&str, &str)) -> R<()> {
    let fid = id(a, "id")?;
    require(ctx, permission)?;
    let Some(row) = first(sql(&format!("SELECT deleted_at FROM {table} WHERE id = ?"), vec![json!(fid)]).await) else { return Ok(()) };
    if row[0].is_null() { return Err("not-in-trash".into()) }
    sql(&format!("DELETE FROM {table} WHERE id = ?"), vec![json!(fid)]).await;
    Ok(())
}

async fn add_audio(a: &Obj, ctx: &Ctx) -> R<()> {
    let (aid, name, kind, hash) = (id(a, "id")?, file_name(a)?, one_of(a, "contentType", &AUDIO_TYPES)?, media_hash(a, "hash")?);
    let (size, created) = (int(a, "size", 1, AUDIO_BYTES)?, safe_int(a, "createdAt")?);
    require(ctx, "ManageAudios")?;
    if found("SELECT id FROM audios WHERE id = ?", vec![json!(aid)]).await { return Ok(()) }
    require_hashes(&[&hash]).await?;
    limit(live("audios").await >= AUDIOS)?;
    sql("INSERT INTO audios (id, file_name, content_type, hash, size, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
        vec![json!(aid), json!(name), json!(kind), json!(hash), json!(size), json!(created)]).await;
    Ok(())
}

async fn add_video(a: &Obj, ctx: &Ctx) -> R<()> {
    let (vid, name) = (id(a, "id")?, file_name(a)?);
    let (kind, codec) = (one_of(a, "contentType", &["video/mp4", "video/quicktime"])?, one_of(a, "codec", &["h264", "hevc"])?);
    let (hash, size, duration) = (media_hash(a, "hash")?, int(a, "size", 1, VIDEO_BYTES)?, int(a, "duration", 0, 24 * 3600 * 1000)?);
    let (width, height) = (int(a, "width", 1, 16_384)?, int(a, "height", 1, 16_384)?);
    let (still, thumb, created) = (media_hash(a, "stillHash")?, media_hash(a, "thumbHash")?, safe_int(a, "createdAt")?);
    require(ctx, "ManageVideos")?;
    if found("SELECT id FROM videos WHERE id = ?", vec![json!(vid)]).await { return Ok(()) }
    require_hashes(&[&hash, &still, &thumb]).await?;
    limit(live("videos").await >= VIDEOS)?;
    sql("INSERT INTO videos (id, file_name, content_type, codec, hash, size, duration, width, height, still_hash, thumb_hash, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
        vec![json!(vid), json!(name), json!(kind), json!(codec), json!(hash), json!(size), json!(duration), json!(width), json!(height), json!(still), json!(thumb), json!(created)]).await;
    Ok(())
}
