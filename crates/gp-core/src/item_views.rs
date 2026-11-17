// The views the web's presentation page and its outputs read: a running order's slides by item, as readItemSlides
// gives them (packages/core/src/item-slides.ts), for the items the page holds.
use crate::args::*;
use crate::slides::{items_slides, Item};
use serde_json::{Map, Value};

fn text(o: &Obj, k: &str) -> Option<String> { o.get(k).and_then(Value::as_str).map(String::from) }

/// `itemSlidesView` {items: [{id, type, title, sourceId, arrangementId, content}]}: each item's slides and why it has
/// none, by item id.
pub async fn item_slides(a: &Obj) -> R<Value> {
    let rows = a.get("items").and_then(Value::as_array).ok_or("invalid-args")?;
    let mut ids = Vec::with_capacity(rows.len());
    let mut items = Vec::with_capacity(rows.len());
    for r in rows {
        let o = obj(r)?;
        ids.push(id(o, "id")?);
        items.push(Item {
            kind: text(o, "type").ok_or("invalid-args")?,
            title: text(o, "title").unwrap_or_default(),
            source_id: text(o, "sourceId").unwrap_or_default(),
            arrangement_id: text(o, "arrangementId"),
            content: text(o, "content"),
        });
    }
    let mut out = Map::new();
    for (id, slides) in ids.into_iter().zip(items_slides(&items).await) { out.insert(id, slides); }
    Ok(Value::Object(out))
}
