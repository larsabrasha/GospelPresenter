// packages/core/src/mutators/song-materials.ts: sheet music, recordings and links on a song.
use super::*;

const MATERIALS_PER_SONG: i64 = 30;
const FILE_TYPES: [&str; 7] = ["application/pdf", "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm", "audio/x-m4a"];
/// The largest file: max(pdfBytes, audioBytes), 20 MiB.
const MAX_FILE_BYTES: i64 = 20 * 1024 * 1024;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "addSongFile" => add_file(a, ctx).await,
        "addSongLink" => add_link(a, ctx).await,
        "renameSongMaterial" => rename(a, ctx).await,
        "removeSongMaterial" => remove(a, ctx).await,
        _ => return None,
    })
}

/// `webAddress`: trimmed, at most 2 000, http or https with a host and no white space (`/^https?:\/\/[^\s/?#]+[^\s]*$/i`).
fn web_address(o: &Obj, k: &str) -> R<String> {
    let Some(Value::String(u)) = o.get(k) else { return Err("invalid-args".into()) };
    let t = js_trim(u);
    let lower: String = t.chars().take(8).collect::<String>().to_ascii_lowercase();
    let rest = if lower.starts_with("https://") { &t[8..] } else if lower.starts_with("http://") { &t[7..] } else { return Err("invalid-args".into()) };
    let host = rest.chars().take_while(|c| !is_js_space(*c) && !matches!(c, '/' | '?' | '#')).count();
    let ok = t.chars().count() <= 2000 && host > 0 && !rest.chars().any(is_js_space);
    if ok { Ok(t.to_string()) } else { Err("invalid-args".into()) }
}

/// The song, if it is there, and the next place after its material.
async fn next_place(song_id: &str) -> R<i64> {
    if !found("SELECT id FROM songs WHERE id = ?", vec![json!(song_id)]).await { return Err("not-found".into()) }
    let n = first(sql("SELECT count(*), max(sort) FROM song_materials WHERE song_id = ?", vec![json!(song_id)]).await).unwrap();
    limit(int_of(&n[0]) >= MATERIALS_PER_SONG)?;
    Ok(if n[1].is_null() { 0 } else { int_of(&n[1]) + 1 })
}

async fn add_file(a: &Obj, ctx: &Ctx) -> R<()> {
    let (mid, sid, title, hash) = (id(a, "id")?, id(a, "songId")?, name(a, "title")?, media_hash(a, "hash")?);
    let kind = one_of(a, "contentType", &FILE_TYPES)?;
    let (size, created) = (int(a, "size", 1, MAX_FILE_BYTES)?, safe_int(a, "createdAt")?);
    require(ctx, "ManageSongs")?;
    if found("SELECT id FROM song_materials WHERE id = ?", vec![json!(mid)]).await { return Ok(()) }
    if !found("SELECT hash FROM media_blobs WHERE hash = ?", vec![json!(hash)]).await { return Err("media-missing".into()) }
    let sort = next_place(&sid).await?;
    sql("INSERT INTO song_materials (id, song_id, kind, title, url, hash, content_type, size, sort, created_at) VALUES (?, ?, 'file', ?, NULL, ?, ?, ?, ?, ?)",
        vec![json!(mid), json!(sid), json!(title), json!(hash), json!(kind), json!(size), json!(sort), json!(created)]).await;
    Ok(())
}

async fn add_link(a: &Obj, ctx: &Ctx) -> R<()> {
    let (mid, sid, title, url, created) = (id(a, "id")?, id(a, "songId")?, name(a, "title")?, web_address(a, "url")?, safe_int(a, "createdAt")?);
    require(ctx, "ManageSongs")?;
    if found("SELECT id FROM song_materials WHERE id = ?", vec![json!(mid)]).await { return Ok(()) }
    let sort = next_place(&sid).await?;
    sql("INSERT INTO song_materials (id, song_id, kind, title, url, hash, content_type, size, sort, created_at) VALUES (?, ?, 'link', ?, ?, NULL, NULL, NULL, ?, ?)",
        vec![json!(mid), json!(sid), json!(title), json!(url), json!(sort), json!(created)]).await;
    Ok(())
}

async fn rename(a: &Obj, ctx: &Ctx) -> R<()> {
    let (mid, title) = (id(a, "id")?, name(a, "title")?);
    require(ctx, "ManageSongs")?;
    sql("UPDATE song_materials SET title = ? WHERE id = ?", vec![json!(title), json!(mid)]).await;
    Ok(())
}

async fn remove(a: &Obj, ctx: &Ctx) -> R<()> {
    let mid = id(a, "id")?;
    require(ctx, "ManageSongs")?;
    sql("DELETE FROM song_materials WHERE id = ?", vec![json!(mid)]).await;
    Ok(())
}
