// packages/core/src/bible.ts's slides and title of a passage, and presentations.ts's addBibleToPresentation, which
// freezes them on the item when it is added (BIBLE-R12, R13).
use crate::args::*;
use crate::json::J;
use crate::mutators::{require, Ctx};
use crate::mutators::presentations::{change_presentation, insert_item, Item};
use crate::bible_books::swedish_name as swedish;
use serde_json::Value;

pub struct Verse { pub b: String, pub c: i64, pub v: i64, pub t: String }

/// `bibleTitle`: `Johannes 3:16`, `Johannes 3:16-18`, `Johannes 3:16-4:2`, `Johannes 21:25 - Apostlagärningarna 1:2`.
fn title(verses: &[Verse]) -> String {
    let (Some(f), Some(l)) = (verses.first(), verses.last()) else { return String::new() };
    let name = swedish(&f.b);
    if f.b != l.b { return format!("{name} {}:{} - {} {}:{}", f.c, f.v, swedish(&l.b), l.c, l.v) }
    if f.c != l.c { return format!("{name} {}:{}-{}:{}", f.c, f.v, l.c, l.v) }
    if f.v != l.v { return format!("{name} {}:{}-{}", f.c, f.v, l.v) }
    format!("{name} {}:{}", f.c, f.v)
}

/// `bibleLabel`, the add button's (spec 05 "Bibeltexter"): the title, with spaces around a dash between chapters.
fn label(verses: &[Verse]) -> String {
    match (verses.first(), verses.last()) {
        (Some(f), Some(l)) if f.b == l.b && f.c != l.c => format!("{} {}:{} - {}:{}", swedish(&f.b), f.c, f.v, l.c, l.v),
        _ => title(verses),
    }
}

/// JavaScript's `length`: UTF-16 code units.
fn len16(s: &str) -> usize { s.encode_utf16().count() }

struct Word { n: Option<i64>, t: String }

fn plain_length(w: &Word) -> usize { len16(&w.t) + w.n.map_or(0, |n| n.to_string().len() + 1) }

/// `splitBibleSlides`: balanced slides of whole words, as many as `total / 250` rounds up to.
fn split(verses: &[Verse]) -> Vec<Vec<(Option<i64>, String)>> {
    let words: Vec<Word> = verses.iter().flat_map(|verse| {
        let parts: Vec<&str> = verse.t.split(' ').filter(|p| !p.is_empty()).collect();
        if parts.is_empty() { vec![Word { n: Some(verse.v), t: String::new() }] }
        else { parts.iter().enumerate().map(|(i, t)| Word { n: if i == 0 { Some(verse.v) } else { None }, t: t.to_string() }).collect() }
    }).collect();
    if words.is_empty() { return vec![] }
    let total = words.iter().map(plain_length).sum::<usize>() + words.len() - 1;
    let count = total.div_ceil(250).max(1);
    let target = total.div_ceil(count);
    let mut slides: Vec<Vec<&Word>> = Vec::new();
    let mut current: Vec<&Word> = Vec::new();
    let mut length = 0;
    for w in &words {
        let candidate = if current.is_empty() { plain_length(w) } else { length + 1 + plain_length(w) };
        if candidate > target && !current.is_empty() && slides.len() < count - 1 {
            slides.push(std::mem::take(&mut current));
            current.push(w);
            length = plain_length(w);
        } else {
            current.push(w);
            length = candidate;
        }
    }
    if !current.is_empty() { slides.push(current) }
    slides.into_iter().map(|slide| {
        let mut segments: Vec<(Option<i64>, String)> = Vec::new();
        for w in slide {
            match segments.last_mut() {
                Some(last) if w.n.is_none() => last.1 = if last.1.is_empty() { w.t.clone() } else { format!("{} {}", last.1, w.t) },
                _ => segments.push((w.n, w.t.clone())),
            }
        }
        segments
    }).collect()
}

/// `verseArg`: book code, chapter and verse 0–999, the text at most 10 000.
fn verse(v: &Value) -> R<Verse> {
    let o = obj(v)?;
    let b = match o.get("b") { Some(Value::String(b)) if b.len() == 3 && b.bytes().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase()) => b.clone(), _ => return Err("invalid-args".into()) };
    let t = match o.get("t") { Some(Value::String(t)) if t.chars().count() <= 10_000 => t.clone(), _ => return Err("invalid-args".into()) };
    Ok(Verse { b, c: int(o, "c", 0, 999)?, v: int(o, "v", 0, 999)?, t })
}

pub async fn add_bible(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, pid, bible_id) = (id(a, "itemId")?, id(a, "presentationId")?, id(a, "bibleId")?);
    let translation = trimmed(a, "translation", 1, 50)?;
    let verses: Vec<Verse> = match a.get("verses") {
        Some(Value::Array(xs)) if (1..=500).contains(&xs.len()) => xs.iter().map(verse).collect::<R<_>>()?,
        _ => return Err("invalid-args".into()),
    };
    let after = opt_id(a, "afterItemId")?;
    require(ctx, "ManagePresentations")?;
    require(ctx, "ViewBibles")?;
    change_presentation(&pid, ctx).await?;
    let (title, content) = frozen(&translation, &verses);
    let item = Item { id: item_id, presentation_id: pid, kind: "bible", title, source_id: bible_id, arrangement_id: None, content: Some(content) };
    insert_item(after, item, None).await?;
    Ok(())
}

/// A passage's item title (at most 200 UTF-16 units) and its content: the translation and the slides, frozen.
fn frozen(translation: &str, verses: &[Verse]) -> (String, String) {
    let slides = split(verses).into_iter()
        .map(|s| J::Arr(s.into_iter().map(|(n, t)| J::obj(vec![("n", n.map_or(J::Null, |n| J::Num(n as f64))), ("t", J::Str(t))])).collect()))
        .collect();
    let content = J::obj(vec![("translation", J::Str(translation.to_string())), ("slides", J::Arr(slides))]).stringify();
    (String::from_utf16_lossy(&title(verses).encode_utf16().take(200).collect::<Vec<_>>()), content)
}

/// `bibleSlidesView` {translation, verses}: what an item of these verses would show, as `addBibleToPresentation` freezes
/// it, for the Bible tab's preview: its title and slides, the output's own. Reads no database.
pub fn slides_view(a: &Obj) -> R<Value> {
    let translation = a.get("translation").and_then(Value::as_str).unwrap_or_default();
    let verses: Vec<Verse> = match a.get("verses") { Some(Value::Array(xs)) => xs.iter().map(verse).collect::<R<_>>()?, _ => return Err("invalid-args".into()) };
    let (title, content) = frozen(translation, &verses);
    let item = crate::slides::Item { kind: "bible".into(), title: title.clone(), source_id: String::new(), arrangement_id: None, content: Some(content) };
    let mut shown = crate::slides::bible(&item);
    shown["title"] = Value::String(title);
    shown["label"] = Value::String(label(&verses));
    Ok(shown)
}
