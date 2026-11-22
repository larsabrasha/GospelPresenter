// Browsing a translation for a reading (spec 05; AddItem/Bible/BibleBookPicker.razor and the rest; the web's
// BibleTab.tsx; the core's since 2026-11-22, so every shell steps alike): a book, then the start's chapter and verse,
// then the end's chapter and verse, each step a crumb to go back to. An end before the start swaps them. What the tab
// reads of the translation next (`ask`, bibleView's arguments) and which verses of the chapter shown are picked.
use crate::args::*;
use serde_json::{json, Map, Value};

const STEPS: [&str; 5] = ["book", "startChapter", "startVerse", "endChapter", "endVerse"];

type At = (i64, i64);

fn at(v: Option<&Value>) -> Option<At> {
    let a = v?.as_array()?;
    Some((a.first()?.as_i64()?, a.get(1)?.as_i64()?))
}

fn pair(a: Option<At>) -> Value { a.map_or(Value::Null, |(c, v)| json!([c, v])) }

struct Browse { book: String, step: String, start: Option<At>, end: Option<At>, end_chapter: Option<i64> }

impl Browse {
    fn read(o: &Obj) -> R<Browse> {
        let step = o.get("step").and_then(Value::as_str).filter(|s| STEPS.contains(s)).ok_or("invalid-args")?.to_string();
        let book = o.get("book").and_then(Value::as_str).ok_or("invalid-args")?.to_string();
        Ok(Browse { book, step, start: at(o.get("start")), end: at(o.get("end")), end_chapter: o.get("endChapter").and_then(Value::as_i64) })
    }

    /// The chapter whose verses are shown, if a verse is being picked.
    fn verse_chapter(&self) -> Option<i64> {
        match self.step.as_str() {
            "startVerse" => self.start.map(|s| s.0),
            "endVerse" => self.end_chapter,
            _ => None,
        }
    }

    fn apply(mut self, e: &Obj) -> R<Browse> {
        let n = e.get("n").and_then(Value::as_i64);
        match e.get("type").and_then(Value::as_str) {
            Some("book") => {
                let book = e.get("book").and_then(Value::as_str).ok_or("invalid-args")?.to_string();
                self = Browse { book, step: "startChapter".into(), start: None, end: None, end_chapter: None };
            }
            Some("chapter") => {
                let n = n.ok_or("invalid-args")?;
                if self.step == "startChapter" {
                    (self.start, self.end, self.end_chapter, self.step) = (Some((n, 0)), None, None, "startVerse".into());
                } else {
                    (self.end_chapter, self.end, self.step) = (Some(n), None, "endVerse".into());
                }
            }
            Some("verse") => {
                let n = n.ok_or("invalid-args")?;
                if self.step == "startVerse" {
                    // The end chapter starts as the start's; the end is then picked in it.
                    let c = self.start.map_or(1, |s| s.0);
                    (self.start, self.end, self.end_chapter, self.step) = (Some((c, n)), None, Some(c), "endVerse".into());
                } else {
                    let picked = (self.end_chapter.ok_or("invalid-args")?, n);
                    match self.start {
                        // An end before the start swaps them.
                        Some(s) if picked < s => (self.start, self.end, self.end_chapter) = (Some(picked), Some(s), Some(s.0)),
                        _ => self.end = Some(picked),
                    }
                }
            }
            Some("step") => {
                let to = e.get("step").and_then(Value::as_str).filter(|s| STEPS.contains(s)).ok_or("invalid-args")?;
                self.step = to.to_string();
            }
            _ => return Err("invalid-args".into()),
        }
        Ok(self)
    }

    fn json(&self) -> Value {
        json!({ "book": self.book, "step": self.step, "start": pair(self.start), "end": pair(self.end), "endChapter": self.end_chapter })
    }
}

/// `bibleBrowseView` {browse: {book, step, start, end, endChapter} | null, event?}: the browse after `event` ({type:
/// "book", book} to start one, {type: "chapter" | "verse", n}, {type: "step", step} a crumb gone back to), and what
/// follows from it: `prompt` (the step's text key), `verseChapter` (the chapter whose verses are shown), `picked` (of
/// those, the verses in the range: {from, to}, `to` null for the chapter's end; null for none), and `ask`, what
/// bibleView is asked besides the books: the book's chapters, the chapter's verses, and the passage picked (start to
/// end, or the start verse alone).
pub fn view(a: &Obj) -> R<Value> {
    let given = a.get("browse").filter(|v| !v.is_null()).map(obj).transpose()?;
    let event = a.get("event").map(obj).transpose()?;
    let browse = match (given, event) {
        (Some(b), Some(e)) => Browse::read(b)?.apply(e)?,
        (Some(b), None) => Browse::read(b)?,
        (None, Some(e)) => Browse { book: String::new(), step: "book".into(), start: None, end: None, end_chapter: None }.apply(e)?,
        (None, None) => return Err("invalid-args".into()),
    };
    let chapter = browse.verse_chapter();
    let start_verse = browse.start.filter(|s| s.1 > 0);
    let picked = match (chapter, start_verse, browse.end) {
        (Some(c), Some(s), None) => (c == s.0).then(|| json!({ "from": s.1, "to": s.1 })),
        (Some(c), Some(s), Some(e)) if s.0 <= c && c <= e.0 => {
            Some(json!({ "from": if c == s.0 { s.1 } else { 1 }, "to": if c == e.0 { json!(e.1) } else { Value::Null } }))
        }
        _ => None,
    };
    let mut ask = Map::new();
    ask.insert("book".into(), json!(browse.book));
    if let Some(c) = chapter { ask.insert("chapter".into(), json!(c)); }
    if let Some(s) = start_verse {
        let to = browse.end.unwrap_or(s);
        ask.insert("passage".into(), json!({ "books": [browse.book], "from": [s.0, s.1], "to": [to.0, to.1] }));
    }
    let prompt = match browse.step.as_str() {
        "book" => "bible.pickBook",
        "startChapter" => "bible.pickStartChapter",
        "startVerse" => "bible.pickStartVerse",
        "endChapter" => "bible.pickEndChapter",
        _ => "bible.pickEndVerse",
    };
    Ok(json!({ "browse": browse.json(), "prompt": prompt, "verseChapter": chapter, "picked": picked, "ask": Value::Object(ask) }))
}

#[cfg(test)]
#[path = "bible_browse_tests.rs"]
mod tests;
