// What the shells show, worked out in the core: the presentations, a presentation's items and slides
// (packages/core/src/slides.ts), and the song search for "Lägg till sång".
use crate::args::*;
use crate::bridge::sql;
use crate::search;
use serde_json::{json, Value};
use std::collections::HashMap;

fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

/// `Some` for a view's name: what it answers.
pub async fn run(name: &str, a: &Obj) -> Option<R<Value>> {
    Some(match name {
        "presentationsView" => Ok(presentations().await),
        "presentationView" => match id(a, "id") { Ok(pid) => presentation(&pid).await, Err(e) => Err(e) },
        "trashView" => Ok(trash().await),
        "liveView" => crate::live::run(a).await,
        "searchSongsView" => Ok(songs(a.get("query").and_then(|q| q.as_str()).unwrap_or("")).await),
        _ => return None,
    })
}

/// The presentations, last changed first, with how many items each has.
async fn presentations() -> Value {
    let rows = sql(
        "SELECT p.id, p.name, p.event_date, p.time, p.location, (SELECT count(*) FROM presentation_items i WHERE i.presentation_id = p.id)
         FROM presentations p WHERE p.deleted_at IS NULL AND p.is_template = 0 ORDER BY p.updated_at DESC, p.name",
        vec![],
    ).await;
    Value::Array(rows.into_iter().map(|r| json!({
        "id": r[0], "name": r[1], "eventDate": r[2], "time": r[3], "location": r[4], "itemCount": r[5],
    })).collect())
}

/// The presentations in the trash, last trashed first.
async fn trash() -> Value {
    Value::Array(sql("SELECT id, name, deleted_at FROM presentations WHERE deleted_at IS NOT NULL AND is_template = 0 ORDER BY deleted_at DESC, name", vec![]).await
        .into_iter().map(|r| json!({ "id": r[0], "name": r[1], "deletedAt": r[2] })).collect())
}

/// Each item's id and how many slides it has, in the running order: what presenting steps through.
pub async fn steps(pid: &str) -> R<Vec<(String, usize)>> {
    let view = presentation(pid).await?;
    Ok(view["items"].as_array().unwrap().iter().map(|i| (s(&i["id"]), i["slides"].as_array().map_or(0, |a| a.len()))).collect())
}

/// A presentation's details, and its items in order, each with its slides.
pub async fn presentation(pid: &str) -> R<Value> {
    let p = sql("SELECT name, event_date, time, location, description FROM presentations WHERE id = ?", vec![json!(pid)]).await
        .into_iter().next().ok_or("not-found")?;
    let labels: HashMap<String, Value> = sql("SELECT id, text, color FROM labels", vec![]).await
        .into_iter().map(|r| (s(&r[0]), json!({ "text": r[1], "color": r[2] }))).collect();
    let rows = sql("SELECT id, type, title, source_id, arrangement_id, content, note FROM presentation_items WHERE presentation_id = ? ORDER BY sort, id", vec![json!(pid)]).await;
    let mut items = Vec::new();
    for r in rows {
        let kind = s(&r[1]);
        let item = crate::slides::Item { kind: kind.clone(), title: s(&r[2]), source_id: s(&r[3]), arrangement_id: r[4].as_str().map(String::from), content: r[5].as_str().map(String::from) };
        let mut shown = crate::slides::item_slides(&item, &labels).await;
        let arrangements = if kind == "song" {
            sql("SELECT id, name FROM song_arrangements WHERE song_id = ? ORDER BY sort, id", vec![r[3].clone()]).await
                .into_iter().map(|a| json!({ "id": a[0], "name": a[1] })).collect()
        } else { vec![] };
        let entry = shown.as_object_mut().unwrap();
        for (k, v) in [("id", r[0].clone()), ("type", json!(kind)), ("title", r[2].clone()), ("note", r[6].clone()), ("arrangementId", r[4].clone()), ("arrangements", Value::Array(arrangements))] {
            entry.insert(k.into(), v);
        }
        items.push(shown);
    }
    Ok(json!({ "id": pid, "name": p[0], "eventDate": p[1], "time": p[2], "location": p[3], "description": p[4], "items": items }))
}

/// The library's songs for "Lägg till sång", best match first (packages/core/src/search.ts).
async fn songs(query: &str) -> Value {
    let rows = sql("SELECT s.id, s.name, s.author, p.content FROM songs s LEFT JOIN song_parts p ON p.song_id = s.id
                    WHERE s.deleted_at IS NULL ORDER BY s.name, s.id, p.sort, p.id", vec![]).await;
    let mut library: Vec<(String, String, String, Vec<String>)> = Vec::new();
    for r in rows {
        if library.last().map(|l| l.0 != s(&r[0])).unwrap_or(true) { library.push((s(&r[0]), s(&r[1]), s(&r[2]), vec![])) }
        if let Some(text) = r[3].as_str() { library.last_mut().unwrap().3.push(text.to_string()) }
    }
    let prepared: Vec<search::Prepared> = library.iter()
        .map(|(_, name, author, parts)| search::prepare(name, author, parts.first().map_or("", |p| p.as_str()), &parts.join("\n")))
        .collect();
    Value::Array(search::rank(&prepared, query).into_iter().take(50).map(|i| json!({ "id": library[i].0, "name": library[i].1 })).collect())
}
