// Lägg till from a library (the web's ImageTab, AudioTab, VideoTab and SlidesTab; the core's since 2026-11-22, so
// every shell picks and adds alike): what a tap picks, and which command adds the pick with which arguments. Pictures
// are picked many at a time, in the order tapped, and become one item (or more of an item's own, from Redigera
// bilder); a sound, a video and a slideshow one at a time. The list itself, its order and its search are
// `libraryOrderView`'s.
use crate::args::*;
use serde_json::{json, Map, Value};

fn ids_of(a: &Obj, k: &str) -> Vec<String> {
    a.get(k).and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect()
}

/// `addPickView` {kind: image | audio | video | slides, picked, event?, presentationId, itemId, afterItemId?,
/// toItemId?}: the pick after `event` ({type: "toggle", id}), and `add`, the command that adds it ({name, args}, none
/// while nothing is picked), with `title` ({key, n}) where the shell names the item in its language (more than one
/// picture) and `added` ({key, n}), what is said after. `toItemId` adds the pictures to that item instead.
pub fn view(a: &Obj) -> R<Value> {
    let kind = one_of(a, "kind", &["image", "audio", "video", "slides"])?;
    let many = kind == "image";
    let mut picked = ids_of(a, "picked");
    if let Some(e) = a.get("event") {
        let e = obj(e)?;
        if e.get("type").and_then(Value::as_str) != Some("toggle") { return Err("invalid-args".into()) }
        let id = id(e, "id")?;
        if picked.contains(&id) { picked.retain(|x| *x != id) } else if many { picked.push(id) } else { picked = vec![id] }
    }
    let n = picked.len();
    let mut title = Value::Null;
    let add = if n == 0 { Value::Null } else {
        let mut args = Map::new();
        let to_item = a.get("toItemId").and_then(Value::as_str).filter(|_| many);
        let name = match (kind.as_str(), to_item) {
            ("image", Some(item)) => { args.insert("itemId".into(), json!(item)); args.insert("imageIds".into(), json!(picked)); "addImagesToItem" }
            (k, _) => {
                args.insert("itemId".into(), json!(id(a, "itemId")?));
                args.insert("presentationId".into(), json!(id(a, "presentationId")?));
                args.insert("afterItemId".into(), a.get("afterItemId").cloned().unwrap_or(Value::Null));
                match k {
                    "image" => {
                        args.insert("imageIds".into(), json!(picked));
                        if n > 1 { title = json!({ "key": "presentation.imagesWord", "n": n }) }
                        "addImageToPresentation"
                    }
                    "audio" => { args.insert("audioId".into(), json!(picked[0])); "addAudioToPresentation" }
                    "video" => { args.insert("videoId".into(), json!(picked[0])); "addVideoToPresentation" }
                    _ => { args.insert("slideId".into(), json!(picked[0])); "addCustomSlideToPresentation" }
                }
            }
        };
        json!({ "name": name, "args": args })
    };
    let added = if n > 1 { json!({ "key": "presentation.imagesAdded", "n": n }) } else { json!({ "key": "presentation.added", "n": n }) };
    Ok(json!({ "picked": picked, "many": many, "add": add, "title": title, "added": added }))
}

#[cfg(test)]
#[path = "add_pick_tests.rs"]
mod tests;
