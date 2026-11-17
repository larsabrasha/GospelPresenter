// The presentation page's view (apps/web/src/pages/presentation-editor): what the page reads, as the web's reads gave
// it (queries.ts) — the presentation, its theme, its items and their slides, the songs and arrangements the items
// use, and the overlays.
use crate::args::*;
use crate::bridge::sql;
use crate::rows::{self, columns, map, ARRANGEMENT, ITEM, OVERLAY, PRESENTATION, SONG};
use serde_json::{json, Map, Value};

fn marks(n: usize) -> String { vec!["?"; n].join(", ") }

/// `presentationPageView` {id}: {presentation (null when there is none), theme, items, slides by item id, songs,
/// arrangements, overlays}.
pub async fn view(a: &Obj) -> R<Value> {
    let pid = id(a, "id")?;
    let items: Vec<Value> = sql(&format!("SELECT {} FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id", columns(ITEM)), vec![json!(pid)]).await
        .iter().map(|r| rows::item(r)).collect();
    let mut song_ids: Vec<Value> = Vec::new();
    for i in items.iter().filter(|i| i["type"] == "song") { if !song_ids.contains(&i["sourceId"]) { song_ids.push(i["sourceId"].clone()) } }
    let slide_items: Vec<crate::slides::Item> = items.iter().map(|i| crate::slides::Item {
        kind: s(&i["type"]), title: s(&i["title"]), source_id: s(&i["sourceId"]),
        arrangement_id: i["arrangementId"].as_str().map(String::from), content: i["content"].as_str().map(String::from),
    }).collect();
    let mut slides = Map::new();
    for (i, shown) in items.iter().zip(crate::slides::items_slides(&slide_items).await) { slides.insert(s(&i["id"]), shown); }
    let presentation = sql(&format!("SELECT {} FROM presentations WHERE id = ?", columns(PRESENTATION)), vec![json!(pid)]).await
        .into_iter().next().map(|r| map(&r, PRESENTATION));
    let theme_id = presentation.as_ref().and_then(|p| p["themeId"].as_str().map(String::from));
    let theme = crate::themes::theme_of(theme_id).await;
    let (songs, arrangements) = if song_ids.is_empty() { (vec![], vec![]) } else {
        let songs = sql(&format!("SELECT {} FROM songs WHERE id IN ({})", columns(SONG), marks(song_ids.len())), song_ids.clone()).await;
        let arrangements = sql(&format!("SELECT {} FROM song_arrangements WHERE song_id IN ({}) ORDER BY sort, id", columns(ARRANGEMENT), marks(song_ids.len())), song_ids).await;
        (songs.iter().map(|r| map(r, SONG)).collect(), arrangements.iter().map(|r| map(r, ARRANGEMENT)).collect())
    };
    Ok(json!({
        "presentation": presentation, "theme": theme, "items": items, "slides": slides,
        "songs": Value::Array(songs), "arrangements": Value::Array(arrangements), "overlays": overlays().await,
    }))
}

fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

/// `listOverlays`: the organisation's overlays, in the order they were made (PRES-R18).
pub async fn overlays() -> Value {
    Value::Array(sql(&format!("SELECT {} FROM overlays ORDER BY sort, id", columns(OVERLAY)), vec![]).await.iter().map(|r| {
        let mut o = map(r, OVERLAY);
        o["imageId"] = Value::Null;
        o
    }).collect())
}
