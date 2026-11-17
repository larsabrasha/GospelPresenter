// The song's pages (apps/web's SongEditor, SongArrangements and SongArrangement, SongHistory, the song materials): the
// song, its parts, arrangements and the labels; the presentations that show it; its history; its sheet music,
// recordings and links, as the web's reads gave them (queries.ts).
use crate::args::*;
use crate::bridge::sql;
use crate::rows::{columns, map, ARRANGEMENT, LABEL, MATERIAL, PART, PRESENTATION, SONG, VERSION};
use serde_json::{json, Value};

/// The rows of `fields` from `sql`, mapped.
async fn all(fields: &[(&str, crate::rows::K)], from: &str, params: Vec<Value>) -> Value {
    Value::Array(sql(&format!("SELECT {} FROM {from}", columns(fields)), params).await.iter().map(|r| map(r, fields)).collect())
}

/// `getSong`: a song by id, trashed or not; null when there is none.
async fn song(id: &str) -> Value {
    sql(&format!("SELECT {} FROM songs WHERE id = ?", columns(SONG)), vec![json!(id)]).await.first().map_or(Value::Null, |r| map(r, SONG))
}

/// `songView` {id}: the song (`getSong`), null when there is none.
pub async fn one(a: &Obj) -> R<Value> { Ok(song(&id(a, "id")?).await) }

/// `songPageView` {id}: {song, parts, arrangements, labels}: the song's page and the pages pushed in from it.
pub async fn page(a: &Obj) -> R<Value> {
    let id = id(a, "id")?;
    Ok(json!({
        "song": song(&id).await,
        "parts": all(PART, "song_parts WHERE song_id IN (?) ORDER BY sort, id", vec![json!(id)]).await,
        "arrangements": all(ARRANGEMENT, "song_arrangements WHERE song_id IN (?) ORDER BY sort, id", vec![json!(id)]).await,
        "labels": all(LABEL, "labels ORDER BY sort, text", vec![]).await,
    }))
}

/// `songPresentationsView` {songId}: the presentations and templates, not in the trash, that show the song (D17).
pub async fn presentations(a: &Obj) -> R<Value> {
    let id = id(a, "songId")?;
    let cols = columns(PRESENTATION).split(", ").map(|c| format!("p.{c}")).collect::<Vec<_>>().join(", ");
    Ok(Value::Array(sql(&format!("SELECT DISTINCT {cols} FROM presentations p JOIN presentation_items i ON i.presentation_id = p.id
         WHERE i.type = 'song' AND i.source_id = ? AND p.deleted_at IS NULL ORDER BY p.name"), vec![json!(id)]).await
        .iter().map(|r| map(r, PRESENTATION)).collect()))
}

/// `songHistoryView` {id}: {song, versions newest first (SONG-R23), the organisation's default theme}.
pub async fn history(a: &Obj) -> R<Value> {
    let id = id(a, "id")?;
    Ok(json!({
        "song": song(&id).await,
        "versions": all(VERSION, "song_versions WHERE song_id = ? ORDER BY created_at DESC, id DESC", vec![json!(id)]).await,
        "theme": crate::themes::theme_of(None).await,
    }))
}

/// `songMaterialsView` {songIds}: the sheet music, recordings and links of the songs, each song's in its order.
pub async fn materials(a: &Obj) -> R<Value> {
    let ids: Vec<Value> = a.get("songIds").and_then(Value::as_array).ok_or("invalid-args")?.clone();
    if ids.is_empty() { return Ok(json!([])) }
    let marks = vec!["?"; ids.len()].join(", ");
    Ok(all(MATERIAL, &format!("song_materials WHERE song_id IN ({marks}) ORDER BY sort, id"), ids).await)
}
