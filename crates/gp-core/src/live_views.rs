// Presenting's reads (apps/web/src/live, pages/Output.tsx, pages/live): the slide shown and what goes with it, the
// item's overlays, a controller's command checked, the video and audio to play, a song to count for CCLI, the outputs
// and the remote control policy, as the web's reads gave them (queries.ts).
use crate::args::*;
use crate::bridge::sql;
use crate::rows::{self, columns, map, K, SONG};
use serde_json::{json, Value};

fn first(rows: Vec<Vec<Value>>) -> Option<Vec<Value>> { rows.into_iter().next() }

/// The item of a presentation, by id, as `itemsOf(…).find(…)` finds it.
async fn item_of(pid: &str, item_id: &str) -> Option<Value> {
    first(sql(&format!("SELECT {} FROM presentation_items WHERE presentation_id = ? AND id = ?", columns(rows::ITEM)), vec![json!(pid), json!(item_id)]).await)
        .map(|r| rows::item(&r))
}

/// `parseCustomPage`: the page stored, or a blank page where it does not read.
fn custom_page(content: &Value) -> Value {
    let parsed = content.as_str().and_then(|c| serde_json::from_str::<Value>(c).ok())
        .and_then(|v| crate::pages::page(&v, &mut Vec::new()).ok())
        .and_then(|p| serde_json::from_str(&p.stringify()).ok());
    parsed.unwrap_or_else(|| json!({ "background": null, "backgroundPicture": null, "backgroundPage": null, "elements": [] }))
}

/// `shownOverlay`: what an overlay shows, null for none or one that is gone.
async fn overlay(id: Option<&str>) -> Value {
    let Some(id) = id else { return Value::Null };
    first(sql("SELECT content FROM overlays WHERE id = ?", vec![json!(id)]).await).map_or(Value::Null, |r| custom_page(&r[0]))
}

/// `overlayView` {id}: what the overlay shows, null for none or one deleted meanwhile (`shownOverlay`).
pub async fn overlay_view(a: &Obj) -> R<Value> { Ok(overlay(opt_id(a, "id")?.as_deref()).await) }

/// `liveSlideView` {presentationId, itemId, partIndex, overlayId}: {name, slide, theme, overlay}. The presentation's
/// name (null when it is gone), the slide shown (null when there is none), the presentation's theme, the overlay shown.
pub async fn slide(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    let item_id = opt_id(a, "itemId")?;
    let part = a.get("partIndex").and_then(Value::as_u64).unwrap_or(0) as usize;
    let p = first(sql("SELECT name, theme_id FROM presentations WHERE id = ?", vec![json!(pid)]).await);
    let mut slide = Value::Null;
    if let Some(item) = match &item_id { Some(i) => item_of(&pid, i).await, None => None } {
        let it = crate::slides::Item {
            kind: s(&item["type"]), title: s(&item["title"]), source_id: s(&item["sourceId"]),
            arrangement_id: item["arrangementId"].as_str().map(String::from), content: item["content"].as_str().map(String::from),
        };
        let shown = crate::slides::items_slides(&[it]).await.pop().unwrap_or(Value::Null);
        slide = shown["slides"].get(part).cloned().unwrap_or(Value::Null);
    }
    let theme = crate::themes::theme_of(p.as_ref().and_then(|r| r[1].as_str().map(String::from))).await;
    Ok(json!({
        "name": p.as_ref().map_or(Value::Null, |r| rows::js_string(&r[0])),
        "slide": slide, "theme": theme, "overlay": overlay(a.get("overlayId").and_then(Value::as_str)).await,
    }))
}

fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

/// `itemOverlaysView` {presentationId}: each item's overlay, [[itemId, overlayId]...] in the running order.
pub async fn item_overlays(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    Ok(Value::Array(sql("SELECT id, overlay_id FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id", vec![json!(pid)]).await
        .into_iter().map(|r| json!([rows::js_string(&r[0]), r[1]])).collect()))
}

/// `liveTargetsView` {presentationId, itemId?, overlayId?}: whether a controller's command still points at what is
/// there (LIVE-R49): the item in the presentation, the overlay not deleted.
pub async fn targets(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    let item = match opt_id(a, "itemId")? { Some(i) => item_of(&pid, &i).await.is_some(), None => true };
    let overlay = match opt_id(a, "overlayId")? {
        Some(o) => !sql("SELECT 1 FROM overlays WHERE id = ?", vec![json!(o)]).await.is_empty(),
        None => true,
    };
    Ok(json!({ "item": item, "overlay": overlay }))
}

/// `LibraryVideo`, its content type and codec read as the web reads them.
pub const VIDEO: &[(&str, K)] = &[("id", K::Str), ("fileName", K::Str), ("contentType", K::Opt), ("codec", K::Opt), ("hash", K::Str), ("size", K::Num),
    ("duration", K::Num), ("width", K::Num), ("height", K::Num), ("stillHash", K::Str), ("thumbHash", K::Str), ("createdAt", K::Num), ("deletedAt", K::Opt)];
/// `LibraryAudio`.
pub const AUDIO: &[(&str, K)] = &[("id", K::Str), ("fileName", K::Str), ("contentType", K::Str), ("hash", K::Str), ("size", K::Num), ("createdAt", K::Num), ("deletedAt", K::Opt)];

/// `libraryVideo`.
pub fn video_row(r: &[Value]) -> Value {
    let mut v = map(r, VIDEO);
    v["contentType"] = json!(if v["contentType"] == "video/quicktime" { "video/quicktime" } else { "video/mp4" });
    v["codec"] = json!(if v["codec"] == "hevc" { "hevc" } else { "h264" });
    v
}

/// `getVideo`: a video by id, trashed or not (MEDIA-R8).
pub async fn video(id: &str) -> Value {
    first(sql(&format!("SELECT {} FROM videos WHERE id = ?", columns(VIDEO)), vec![json!(id)]).await).map_or(Value::Null, |r| video_row(&r))
}

/// `livePlaybackView` {presentationId, itemId}: the item shown, its video and the next item's, which buffers.
pub async fn playback(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    let item_id = opt_id(a, "itemId")?;
    let items = sql("SELECT id, type, source_id FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id", vec![json!(pid)]).await;
    let at = items.iter().position(|r| Some(s(&r[0])) == item_id);
    let video_of = |k: usize| items.get(k).filter(|r| r[1] == "video").map(|r| s(&r[2]));
    let (shown, next) = match at { Some(k) => (video_of(k), video_of(k + 1)), None => (None, None) };
    Ok(json!({
        "item": at.map_or(Value::Null, |k| json!({ "id": rows::js_string(&items[k][0]), "type": rows::item_kind(&items[k][1]) })),
        "video": match shown { Some(v) => video(&v).await, None => Value::Null },
        "nextVideo": match next { Some(v) => video(&v).await, None => Value::Null },
    }))
}

/// `itemAudioView` {itemId}: an audio item's file, null for another kind of item or a file gone.
pub async fn item_audio(a: &Obj) -> R<Value> {
    let Some(item_id) = opt_id(a, "itemId")? else { return Ok(Value::Null) };
    let Some(r) = first(sql("SELECT source_id FROM presentation_items WHERE id = ? AND type = 'audio'", vec![json!(item_id)]).await) else { return Ok(Value::Null) };
    Ok(first(sql(&format!("SELECT {} FROM audios WHERE id = ?", columns(AUDIO)), vec![r[0].clone()]).await).map_or(Value::Null, |r| map(&r, AUDIO)))
}

/// `ccliUseView` {presentationId, itemId}: what to record when a slide has been shown long enough (SONG-R48–R53), or
/// null: collection off, not a song, or a song without a CCLI number.
pub async fn ccli_use(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    let item_id = opt_id(a, "itemId")?;
    let on = first(sql("SELECT value FROM org_settings WHERE id = 'ccliCollection'", vec![]).await).is_some_and(|r| r[0] == "true");
    let Some(item) = (if on { match &item_id { Some(i) => item_of(&pid, i).await, None => None } } else { None }) else { return Ok(Value::Null) };
    if item["type"] != "song" { return Ok(Value::Null) }
    let Some(song) = first(sql(&format!("SELECT {} FROM songs WHERE id = ?", columns(SONG)), vec![item["sourceId"].clone()]).await).map(|r| map(&r, SONG)) else { return Ok(Value::Null) };
    if song["ccli"].as_str().is_none_or(|c| js_trim(c).is_empty()) { return Ok(Value::Null) }
    let name = first(sql("SELECT name FROM presentations WHERE id = ?", vec![json!(pid)]).await).map_or(json!(""), |r| rows::js_string(&r[0]));
    Ok(json!({ "songId": song["id"], "songName": song["name"], "ccli": song["ccli"], "presentationId": pid, "presentationName": name }))
}

/// `displaysView`: the organisation's outputs as rows; the page orders them by its language (`listDisplays`).
pub async fn displays() -> R<Value> {
    Ok(Value::Array(sql("SELECT id, name, code, kind, created_at FROM displays ORDER BY id", vec![]).await.into_iter().map(|r| json!({
        "id": r[0], "name": r[1], "code": r[2], "kind": if r[3] == "screen" { "screen" } else { "public" }, "createdAt": r[4],
    })).collect()))
}

/// `remoteControlView`: the organisation's remote control policy (`remoteControlPolicy`): no row, or a value not known,
/// is the presenter's choice.
pub async fn remote_control() -> R<Value> {
    let v = first(sql("SELECT value FROM org_settings WHERE id = 'remoteControl'", vec![]).await).and_then(|r| r[0].as_str().map(String::from));
    Ok(json!(match v.as_deref() { Some(p @ ("never" | "presenter" | "always")) => p, _ => "presenter" }))
}
