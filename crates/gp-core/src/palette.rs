// ⌘K, the search of everything (Lars, 2026-11-05; the web's CommandPalette.tsx, the core's since 2026-11-22): which
// presentations a search finds and in which order, the same in every shell. The songs are `searchSongsView`'s, the
// pages of Inställningar `settingsSearchView`'s; the commands and the page's own actions are each shell's, in its words.
use crate::args::*;
use serde_json::{json, Value};

/// At most this many of a kind, as Spotlight shows a few of each; with nothing typed, the three coming first.
const PER_GROUP: usize = 5;
const BLANK: usize = 3;

/// `paletteView` {query, today, locale?, labels?}: the presentations found by name, place or date (as the web writes
/// it in `labels`, by id, else as `dateLineView` writes it in `locale`'s words, "sön 22 november 2026"), the coming
/// ones first (soonest first), then the past (latest first); at most five, or with nothing typed the first three. Each
/// with its `line`: the date with its year and the time (`dateLineView`'s parts).
pub async fn view(a: &Obj) -> R<Value> {
    let q = a.get("query").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    let today = a.get("today").and_then(Value::as_str).ok_or("invalid-args")?;
    let labels = a.get("labels").and_then(Value::as_object);
    let en = crate::date_line::english(a);
    let all = crate::lists::presentations().await?;
    let label = |p: &Value| -> Option<String> {
        match labels {
            Some(l) => l.get(p["id"].as_str().unwrap_or("")).and_then(Value::as_str).map(String::from),
            None => p["eventDate"].as_str().and_then(|d| crate::date_line::date_label(d, today, true, en)["text"].as_str().map(String::from)),
        }
    };
    let found = |p: &Value| {
        if q.is_empty() { return true }
        let written = label(p);
        let hit = [p["name"].as_str(), p["location"].as_str(), p["eventDate"].as_str(), written.as_deref()].into_iter().flatten().any(|t| t.to_lowercase().contains(&q));
        hit
    };
    let mut list: Vec<Value> = all.as_array().into_iter().flatten().filter(|p| found(p)).cloned().collect();
    let date = |p: &Value| p["eventDate"].as_str().map(String::from);
    let coming = |p: &Value| date(p).is_some_and(|d| d.as_str() >= today);
    list.sort_by(|x, y| {
        coming(y).cmp(&coming(x)).then_with(|| if coming(x) { date(x).cmp(&date(y)) } else { date(y).unwrap_or_default().cmp(&date(x).unwrap_or_default()) })
    });
    list.truncate(if q.is_empty() { BLANK } else { PER_GROUP });
    for p in list.iter_mut() {
        let when = json!({ "eventDate": p["eventDate"], "time": p["time"] });
        p["line"] = crate::date_line::parts(&when, today, true, true, en, false);
    }
    Ok(json!({ "presentations": list }))
}
