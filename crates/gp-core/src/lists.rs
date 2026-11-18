// The presentations page, the templates, the trash and the lists other pages read beside their own (apps/web's
// Presentations, Templates, Trash, Storage, Labels, the command palette and song import), as the web's reads gave
// them (queries.ts). An order by name in the page's language stays the shell's (Intl.Collator): those come as rows.
use crate::args::*;
use crate::bridge::sql;
use crate::collation::{lang, sort, Key};
use crate::live_views::{video_row, AUDIO, VIDEO};
use crate::media_views::{image_row, IMAGE};
use crate::rows::{self, columns, map, LABEL, PART, PRESENTATION, SONG};
use serde_json::{json, Value};

fn rows_of(fields: &[(&str, rows::K)], from: &str) -> String { format!("SELECT {} FROM {from}", columns(fields)) }

/// `presentationListView`: the presentations, newest event first, those without a date last (`listPresentations`).
pub async fn presentations() -> R<Value> {
    let q = rows_of(PRESENTATION, "presentations WHERE deleted_at IS NULL AND is_template = 0 ORDER BY event_date IS NULL, event_date DESC, name");
    Ok(Value::Array(sql(&q, vec![]).await.iter().map(|r| map(r, PRESENTATION)).collect()))
}

/// `templatesView` {locale}: the templates, last changed first, then by name in the page's language and by id
/// (`listTemplates`).
pub async fn templates(a: &Obj) -> R<Value> {
    let mut rows: Vec<Value> = sql(&rows_of(PRESENTATION, "presentations WHERE deleted_at IS NULL AND is_template = 1"), vec![]).await.iter().map(|r| map(r, PRESENTATION)).collect();
    sort(lang(a), &mut rows, &[Key::Last("updatedAt"), Key::Name("name"), Key::Id("id")]);
    Ok(Value::Array(rows))
}

/// `itemCountsView`: how many items each presentation has, [[id, n]...]; one with none is missing (`itemCounts`).
pub async fn item_counts() -> R<Value> {
    Ok(Value::Array(sql("SELECT presentation_id AS id, COUNT(*) AS n FROM presentation_items GROUP BY presentation_id", vec![]).await
        .into_iter().map(|r| json!([r[0], r[1]])).collect()))
}

/// `itemsView` {presentationId}: a presentation's items in order (`itemsOf`).
pub async fn items(a: &Obj) -> R<Value> {
    let pid = id(a, "presentationId")?;
    Ok(Value::Array(sql(&rows_of(rows::ITEM, "presentation_items WHERE presentation_id = ? ORDER BY sort, id"), vec![json!(pid)]).await.iter().map(|r| rows::item(r)).collect()))
}

/// `labelsView`: the labels in their order (`listLabels`).
pub async fn labels() -> R<Value> { Ok(Value::Array(sql(&rows_of(LABEL, "labels ORDER BY sort, text"), vec![]).await.iter().map(|r| map(r, LABEL)).collect())) }

/// `songPartsView` {songIds}: the parts of these songs, in order (`songPartsOf`).
pub async fn song_parts(a: &Obj) -> R<Value> {
    let ids: Vec<Value> = a.get("songIds").and_then(Value::as_array).ok_or("invalid-args")?.clone();
    if ids.is_empty() { return Ok(json!([])) }
    let q = rows_of(PART, &format!("song_parts WHERE song_id IN ({}) ORDER BY sort, id", vec!["?"; ids.len()].join(", ")));
    Ok(Value::Array(sql(&q, ids).await.iter().map(|r| map(r, PART)).collect()))
}

/// `pinnedView`: the presentations this device keeps offline ("Tillgänglig offline").
pub async fn pinned() -> R<Value> { Ok(Value::Array(sql("SELECT id FROM pinned_presentations", vec![]).await.into_iter().map(|r| r[0].clone()).collect())) }

/// `trashEntriesView`: what is in the trash (spec 03 section 5) as `listTrash`'s entries, slideshows, videos, pictures,
/// sounds, presentations and templates, songs; the page orders them, newest deletion first.
pub async fn trash() -> R<Value> {
    let mut out = Vec::new();
    let entry = |kind: &str, id: &Value, name: Value, detail: Value, deleted: &Value| json!({ "kind": kind, "id": id, "name": name, "detail": detail, "deletedAt": deleted });
    for r in sql("SELECT id, name, deleted_at FROM custom_slides WHERE deleted_at IS NOT NULL", vec![]).await {
        out.push(json!({ "kind": "Slide", "id": r[0], "name": r[1], "detail": null, "deletedAt": map(&r[2..3], &[("n", rows::K::Num)])["n"] }));
    }
    for r in sql(&rows_of(VIDEO, "videos WHERE deleted_at IS NOT NULL"), vec![]).await { let v = video_row(&r); out.push(entry("Video", &v["id"], v["fileName"].clone(), Value::Null, &v["deletedAt"])) }
    for r in sql(&rows_of(IMAGE, "images WHERE deleted_at IS NOT NULL"), vec![]).await { let v = image_row(&r); out.push(entry("Image", &v["id"], v["fileName"].clone(), Value::Null, &v["deletedAt"])) }
    for r in sql(&rows_of(AUDIO, "audios WHERE deleted_at IS NOT NULL"), vec![]).await { let v = map(&r, AUDIO); out.push(entry("Audio", &v["id"], v["fileName"].clone(), Value::Null, &v["deletedAt"])) }
    for r in sql(&rows_of(PRESENTATION, "presentations WHERE deleted_at IS NOT NULL"), vec![]).await {
        let p = map(&r, PRESENTATION);
        out.push(if p["isTemplate"] == true {
            json!({ "kind": "Template", "id": p["id"], "name": p["name"], "detail": null, "template": p, "deletedAt": p["deletedAt"] })
        } else {
            entry("Presentation", &p["id"], p["name"].clone(), p["eventDate"].clone(), &p["deletedAt"])
        });
    }
    for r in sql(&rows_of(SONG, "songs WHERE deleted_at IS NOT NULL"), vec![]).await { let s = map(&r, SONG); out.push(entry("Song", &s["id"], s["name"].clone(), s["author"].clone(), &s["deletedAt"])) }
    Ok(Value::Array(out))
}
