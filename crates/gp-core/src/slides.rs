// What each item of a running order shows: packages/core's readItemSlides (item-slides.ts) and the slides it builds
// (slides.ts, bible.ts, custom-slides.ts), the same objects, reading the library through the shell.
use crate::args::js_trim;
use crate::bridge::sql;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }
fn first(rows: Vec<Vec<Value>>) -> Option<Vec<Value>> { rows.into_iter().next() }

/// An item as the slides read it.
pub struct Item { pub kind: String, pub title: String, pub source_id: String, pub arrangement_id: Option<String>, pub content: Option<String> }

fn slide(key: &str, kind: &str, text: &str) -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in [("key", json!(key)), ("kind", json!(kind)), ("text", json!(text)), ("verses", Value::Null), ("image", Value::Null), ("label", Value::Null), ("credits", Value::Null)] {
        m.insert(k.into(), v);
    }
    m
}

fn none(problem: &str) -> Value { json!({ "slides": [], "problem": problem }) }
fn some(slides: Vec<Value>, empty: Option<&str>) -> Value {
    let problem = if slides.is_empty() { empty.map_or(Value::Null, |p| json!(p)) } else { Value::Null };
    json!({ "slides": slides, "problem": problem })
}

/// `songCredits`: "Author · © Publisher · Year", the missing pieces dropped; null if there are none.
fn song_credits(author: &Value, publisher: &Value, year: &Value) -> Value {
    let publisher = publisher.as_str().filter(|p| !p.is_empty()).map(|p| format!("© {p}"));
    let year = year.as_i64().filter(|y| *y != 0).map(|y| y.to_string());
    let kept: Vec<String> = [author.as_str().map(String::from), publisher, year].into_iter().flatten().filter(|p| !js_trim(p).is_empty()).collect();
    if kept.is_empty() { Value::Null } else { json!(kept.join(" · ")) }
}

/// `parsePartIds`: an arrangement's part ids; anything else reads as empty.
fn part_ids(text: &str) -> Vec<String> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

/// `songSlides`: one slide per arranged part (SONG-R18, R19), a repeated part keyed `id#n`.
async fn song(item: &Item, labels: &HashMap<String, Value>) -> Value {
    let Some(song) = first(sql("SELECT deleted_at, author, publisher, year FROM songs WHERE id = ?", vec![json!(item.source_id)]).await) else { return none("song-missing") };
    if !song[0].is_null() { return none("song-trashed") } // D17: skipped live
    let credits = song_credits(&song[1], &song[2], &song[3]);
    let mut parts = sql("SELECT id, sort, label_id, content FROM song_parts WHERE song_id = ?", vec![json!(item.source_id)]).await;
    parts.sort_by(|a, b| a[1].as_i64().cmp(&b[1].as_i64()).then(s(&a[0]).cmp(&s(&b[0]))));
    let mut arrangements = sql("SELECT id, part_ids, sort FROM song_arrangements WHERE song_id = ?", vec![json!(item.source_id)]).await;
    arrangements.sort_by(|a, b| a[2].as_i64().cmp(&b[2].as_i64()).then(s(&a[0]).cmp(&s(&b[0]))));
    let wanted = item.arrangement_id.clone().or_else(|| arrangements.first().map(|a| s(&a[0])));
    let arranged: Vec<&Vec<Value>> = match wanted.and_then(|w| arrangements.iter().find(|a| s(&a[0]) == w)) {
        None => parts.iter().collect(),
        Some(arr) => part_ids(&s(&arr[1])).iter().filter_map(|pid| parts.iter().find(|p| s(&p[0]) == *pid)).collect(),
    };
    let mut seen: HashMap<String, usize> = HashMap::new();
    let slides = arranged.into_iter().map(|p| {
        let pid = s(&p[0]);
        let n = seen.entry(pid.clone()).or_insert(0);
        let key = if *n == 0 { pid.clone() } else { format!("{pid}#{n}") };
        *n += 1;
        let mut m = slide(&key, "song", &s(&p[3]));
        m.insert("label".into(), p[2].as_str().and_then(|l| labels.get(l)).cloned().unwrap_or(Value::Null));
        m.insert("credits".into(), credits.clone());
        Value::Object(m)
    }).collect();
    some(slides, Some("no-parts"))
}

/// `parseBibleContent` (bibleItemContentSchema): a translation and its frozen slides, or none where they do not read.
fn bible_content(content: &Option<String>) -> Option<(String, Vec<Vec<(Option<i64>, String)>>)> {
    let c: Value = serde_json::from_str(content.as_deref()?).ok()?;
    let translation = c.get("translation")?.as_str()?;
    if translation.chars().count() > 50 { return None }
    let slides = c.get("slides")?.as_array()?;
    if slides.len() > 1000 { return None }
    slides.iter().map(|sl| {
        let runs = sl.as_array()?;
        if runs.len() > 500 { return None }
        runs.iter().map(|r| {
            let n = match r.get("n")? { Value::Null => None, v => Some(v.as_f64().filter(|f| f.fract() == 0.0 && (0.0..=999.0).contains(f))? as i64) };
            let t = r.get("t")?.as_str()?;
            if t.chars().count() > 10_000 { return None }
            Some((n, t.to_string()))
        }).collect()
    }).collect::<Option<Vec<_>>>().map(|s| (translation.to_string(), s))
}

/// `bibleItemSlides`: the frozen slides, each run with its verse number if it starts a verse.
fn bible(item: &Item) -> Value {
    let Some((translation, slides)) = bible_content(&item.content) else { return some(vec![], Some("no-parts")) };
    let credits = if translation.is_empty() { item.title.clone() } else { format!("{} · {}", item.title, translation) };
    let out = slides.into_iter().enumerate().map(|(i, runs)| {
        let text: Vec<String> = runs.iter().map(|(n, t)| match n { None => t.clone(), Some(n) if t.is_empty() => n.to_string(), Some(n) => format!("{n} {t}") }).collect();
        let mut m = slide(&format!("b{i}"), "bible", &text.join(" "));
        m.insert("verses".into(), Value::Array(runs.into_iter().map(|(n, t)| json!({ "n": n, "t": t })).collect()));
        m.insert("credits".into(), json!(credits));
        Value::Object(m)
    }).collect();
    some(out, Some("no-parts"))
}

/// `imageItemIds`: an image item's pictures, by library id; one made before there could be several shows its source.
fn image_ids(item: &Item) -> Vec<String> {
    let fallback = vec![item.source_id.clone()];
    let Some(content) = item.content.as_deref().filter(|c| !c.is_empty()) else { return fallback };
    let Ok(v) = serde_json::from_str::<Value>(content) else { return fallback };
    match v.get("images").and_then(Value::as_array) {
        Some(a) if (1..=50).contains(&a.len()) && a.iter().all(|x| x.as_str().is_some_and(|s| (1..=64).contains(&s.chars().count()))) => {
            a.iter().map(|x| s(x)).collect()
        }
        _ => fallback,
    }
}

async fn image(item: &Item) -> Value {
    let mut out = Vec::new();
    for (i, id) in image_ids(item).iter().enumerate() {
        // A trashed picture still shows (MEDIA-R8); a purged one is gone.
        if let Some(r) = first(sql("SELECT full_hash, thumb_hash FROM images WHERE id = ?", vec![json!(id)]).await) {
            let mut m = slide(&format!("image{i}"), "media", "");
            m.insert("image".into(), r[0].clone());
            m.insert("thumb".into(), r[1].clone());
            out.push(Value::Object(m));
        }
    }
    if out.is_empty() { none("image-missing") } else { some(out, None) }
}

async fn audio(item: &Item) -> Value {
    let Some(r) = first(sql("SELECT hash, file_name FROM audios WHERE id = ?", vec![json!(item.source_id)]).await) else { return none("audio-missing") };
    let mut m = slide("audio", "media", "");
    m.insert("audio".into(), json!({ "name": r[1] }));
    json!({ "slides": [Value::Object(m)], "problem": null, "audio": { "hash": r[0], "fileName": r[1] } })
}

const VIDEO_COLUMNS: [&str; 13] = ["id", "file_name", "content_type", "codec", "hash", "size", "duration", "width", "height", "still_hash", "thumb_hash", "created_at", "deleted_at"];

fn camel(column: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for c in column.chars() { if c == '_' { up = true } else if up { out.extend(c.to_uppercase()); up = false } else { out.push(c) } }
    out
}

async fn video(item: &Item) -> Value {
    let q = format!("SELECT {} FROM videos WHERE id = ?", VIDEO_COLUMNS.join(", "));
    let Some(r) = first(sql(&q, vec![json!(item.source_id)]).await) else { return none("video-missing") };
    let row: Map<String, Value> = VIDEO_COLUMNS.iter().zip(&r).map(|(c, v)| (camel(c), v.clone())).collect();
    let mut m = slide("video", "media", "");
    m.insert("image".into(), row["stillHash"].clone());
    m.insert("thumb".into(), row["thumbHash"].clone());
    m.insert("video".into(), json!({ "hash": row["hash"], "type": row["contentType"], "codec": row["codec"] }));
    json!({ "slides": [Value::Object(m)], "problem": null, "video": Value::Object(row) })
}

/// `customPageText`: a page's texts top to bottom, then left to right, one to a line.
fn page_text(page: &Value) -> String {
    let mut texts: Vec<&Value> = page["elements"].as_array().map(|e| e.iter().filter(|e| e["kind"] == "text" && !js_trim(e["text"].as_str().unwrap_or("")).is_empty()).collect()).unwrap_or_default();
    let num = |v: &Value| v.as_f64().unwrap_or(0.0);
    texts.sort_by(|a, b| (num(&a["y"]) - num(&b["y"])).partial_cmp(&0.0).unwrap().then((num(&a["x"]) - num(&b["x"])).partial_cmp(&0.0).unwrap()));
    texts.iter().map(|e| js_trim(e["text"].as_str().unwrap_or("")).to_string()).collect::<Vec<_>>().join("\n")
}

async fn custom(item: &Item) -> Value {
    let Some(r) = first(sql("SELECT pages FROM custom_slides WHERE id = ?", vec![json!(item.source_id)]).await) else { return none("custom-missing") };
    // A page a slide; a PDF's page is a picture slide too. Not checked against the schema as the TS core does.
    let blank = json!([{ "background": null, "backgroundPicture": null, "backgroundPage": null, "elements": [] }]);
    let pages = serde_json::from_str::<Value>(&s(&r[0])).ok().filter(|p| p.as_array().is_some_and(|a| !a.is_empty())).unwrap_or(blank);
    let slides = pages.as_array().unwrap().iter().enumerate().map(|(i, page)| {
        let pdf = page.get("backgroundPage").filter(|p| !p.is_null());
        let mut m = slide(&format!("page{i}"), if pdf.is_some() { "media" } else { "song" }, &page_text(page));
        m.insert("image".into(), pdf.map_or(Value::Null, |p| p["full"].clone()));
        m.insert("thumb".into(), pdf.map_or(Value::Null, |p| p["thumb"].clone()));
        m.insert("custom".into(), page.clone());
        Value::Object(m)
    }).collect();
    some(slides, None)
}

/// An item's slides and why it has none; any other kind is read as a song is, as the TS core does.
pub async fn item_slides(item: &Item, labels: &HashMap<String, Value>) -> Value {
    match item.kind.as_str() {
        "header" => some(vec![], None), // a heading shows nothing: presenting steps over it (spec 03 2f)
        "bible" => bible(item),
        "audio" => audio(item).await,
        "video" => video(item).await,
        "custom" => custom(item).await,
        "image" => image(item).await,
        _ => song(item, labels).await,
    }
}
