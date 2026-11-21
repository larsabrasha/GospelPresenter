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

/// `songHistoryPageView` {id, today, yesterday}: the history page as it shows it (the web's SongHistory.tsx and
/// songHistory.ts): the versions newest first in runs by day, each run's `day` today, yesterday, or before (a heading of
/// its date, the shell's to write) by the starts of today and yesterday in the device's time zone (`today`,
/// `yesterday`, ms, the shell's); each version its id, time, and as it was then its name, author and a slide per part
/// with its label (`versionSlides`), drawn in the organisation's default `theme`.
pub async fn history_page(a: &Obj) -> R<Value> {
    let h = history(a).await?;
    let today = a.get("today").and_then(Value::as_f64).unwrap_or(f64::MAX);
    let yesterday = a.get("yesterday").and_then(Value::as_f64).unwrap_or(f64::MAX);
    let mut days: Vec<Value> = Vec::new();
    for v in h["versions"].as_array().cloned().unwrap_or_default() {
        let at = v["createdAt"].as_f64().unwrap_or(0.0);
        let day = if at >= today { "today" } else if at >= yesterday { "yesterday" } else { "before" };
        let snap: Value = v["data"].as_str().and_then(|d| serde_json::from_str(d).ok()).unwrap_or(Value::Null);
        let slides: Vec<Value> = snap["parts"].as_array().cloned().unwrap_or_default().iter().map(|p| json!({
            "key": p["id"], "kind": "song", "text": p["content"], "verses": null, "image": null, "credits": null,
            "label": if p["labelText"].as_str().is_some_and(|t| !t.is_empty()) { json!({ "text": p["labelText"], "color": p["labelColor"].as_str().unwrap_or("#6b7280") }) } else { Value::Null },
        })).collect();
        let version = json!({ "id": v["id"], "at": at, "name": snap["name"], "author": snap["author"], "slides": slides });
        // Today and yesterday each one run; before, a run a calendar day, which the shell tells apart by `at`.
        match days.last_mut() {
            Some(d) if d["day"] == day && day != "before" => d["versions"].as_array_mut().unwrap().push(version),
            _ => days.push(json!({ "day": day, "versions": [version] })),
        }
    }
    Ok(json!({ "days": days, "theme": h["theme"] }))
}

/// `songMaterialsView` {songIds}: the sheet music, recordings and links of the songs, each song's in its order.
pub async fn materials(a: &Obj) -> R<Value> {
    let ids: Vec<Value> = a.get("songIds").and_then(Value::as_array).ok_or("invalid-args")?.clone();
    if ids.is_empty() { return Ok(json!([])) }
    let marks = vec!["?"; ids.len()].join(", ");
    Ok(all(MATERIAL, &format!("song_materials WHERE song_id IN ({marks}) ORDER BY sort, id"), ids).await)
}
