// ⌘K, the search of everything (Lars, 2026-11-05; the web's CommandPalette.tsx, the core's since 2026-11-22): which
// presentations a search finds and in which order, the same in every shell. The songs are `searchSongsView`'s, the
// pages of Inställningar `settingsSearchView`'s; the commands and the page's own actions are each shell's, in its words.
use crate::args::*;
use serde_json::{json, Value};

/// At most this many of a kind, as Spotlight shows a few of each; with nothing typed, the three coming first.
const PER_GROUP: usize = 5;
const BLANK: usize = 3;

/// `paletteView` {query, today, labels?}: the presentations found by name, place or date (`labels`, by id, the date as
/// the shell writes it, "sön 22 november"), the coming ones first (soonest first), then the past (latest first); at
/// most five, or with nothing typed the first three.
pub async fn view(a: &Obj) -> R<Value> {
    let q = a.get("query").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    let today = a.get("today").and_then(Value::as_str).ok_or("invalid-args")?;
    let labels = a.get("labels").and_then(Value::as_object);
    let all = crate::lists::presentations().await?;
    let found = |p: &Value| {
        if q.is_empty() { return true }
        let label = labels.and_then(|l| l.get(p["id"].as_str().unwrap_or(""))).and_then(Value::as_str);
        [p["name"].as_str(), p["location"].as_str(), p["eventDate"].as_str(), label].into_iter().flatten().any(|t| t.to_lowercase().contains(&q))
    };
    let mut list: Vec<Value> = all.as_array().into_iter().flatten().filter(|p| found(p)).cloned().collect();
    let date = |p: &Value| p["eventDate"].as_str().map(String::from);
    let coming = |p: &Value| date(p).is_some_and(|d| d.as_str() >= today);
    list.sort_by(|x, y| {
        coming(y).cmp(&coming(x)).then_with(|| if coming(x) { date(x).cmp(&date(y)) } else { date(y).unwrap_or_default().cmp(&date(x).unwrap_or_default()) })
    });
    list.truncate(if q.is_empty() { BLANK } else { PER_GROUP });
    Ok(json!({ "presentations": list }))
}
