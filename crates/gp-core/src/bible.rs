// packages/core/src/bible.ts's slides and title of a passage, and presentations.ts's addBibleToPresentation, which
// freezes them on the item when it is added (BIBLE-R12, R13).
use crate::args::*;
use crate::json::J;
use crate::mutators::{require, Ctx};
use crate::mutators::presentations::{change_presentation, insert_item, Item};
use crate::bible_books::swedish_name as swedish;
use serde_json::Value;

pub struct Verse { pub b: String, pub c: i64, pub v: i64, pub t: String }

/// `MAX_VERSES_PER_ITEM`: the verses one item may hold (BIBLE-R14).
pub const VERSES_PER_ITEM: usize = 500;

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

/// How a break after a word costs (Lars, 2026-11-19: no word of a sentence left alone on the next slide): nothing
/// before a verse, little after a sentence, more after a clause, most within one; and more where a sentence's first or
/// last one or two words would stand apart from the rest of it.
const BREAK_AT_VERSE: f64 = 0.0;
const BREAK_AT_SENTENCE: f64 = 1.0;
const BREAK_AT_CLAUSE: f64 = 2.0;
const BREAK_AT_COMMA: f64 = 3.0;
const BREAK_WITHIN: f64 = 6.0;
const BREAK_FRAGMENT: f64 = 4.0;
/// What a slide's length apart from the target costs: this times the share apart, squared.
const UNEVEN: f64 = 20.0;
/// The longest a slide gets, of the target, unless one word is longer.
const LONGEST: f64 = 1.4;

/// A word's last mark before closing quotes and brackets: 3 ends a sentence, 2 a clause, 1 a comma's, 0 none.
fn mark(t: &str) -> u8 {
    match t.trim_end_matches(['"', '\'', '”', '’', '»', ')', ']']).chars().last() {
        Some('.' | '!' | '?' | '…') => 3,
        Some(';' | ':') => 2,
        Some(',' | '–' | '—') => 1,
        _ => 0,
    }
}

/// `splitBibleSlides`, 2.0's (Lars, 2026-11-19): slides about `total / ceil(total / 250)` long, broken where reading
/// pauses: the cheapest set of breaks (`BREAK_*`, `UNEVEN`) over every way to break, found word by word, a slide at
/// most `LONGEST` the target. Not held to that many slides: where the breaks within sentences cost more than longer
/// slides, there are fewer (2 % on a real Bible), as Lars took (2026-11-19).
fn split(verses: &[Verse]) -> Vec<Vec<(Option<i64>, String)>> {
    let words: Vec<Word> = verses.iter().flat_map(|verse| {
        let parts: Vec<&str> = verse.t.split(' ').filter(|p| !p.is_empty()).collect();
        if parts.is_empty() { vec![Word { n: Some(verse.v), t: String::new() }] }
        else { parts.iter().enumerate().map(|(i, t)| Word { n: if i == 0 { Some(verse.v) } else { None }, t: t.to_string() }).collect() }
    }).collect();
    if words.is_empty() { return vec![] }
    let breaks = breaks(&words);
    let mut slides: Vec<Vec<&Word>> = Vec::new();
    let mut from = 0;
    for to in breaks { slides.push(words[from..to].iter().collect()); from = to; }
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

/// Where the slides of `words` end (each the index after its last word): the cheapest breaks by dynamic programming,
/// each slide's cost its length apart from the target and the break after it.
fn breaks(words: &[Word]) -> Vec<usize> {
    let n = words.len();
    let lengths: Vec<usize> = words.iter().map(plain_length).collect();
    let total = lengths.iter().sum::<usize>() + n - 1;
    let target = total as f64 / total.div_ceil(250).max(1) as f64;
    let marks: Vec<u8> = words.iter().map(|w| mark(&w.t)).collect();
    // The words of the sentence up to each word since the last one that ended a sentence, and from each to the next end.
    let mut back = vec![0usize; n];
    for i in 0..n { back[i] = if i > 0 && marks[i - 1] < 3 { back[i - 1] + 1 } else { 1 } }
    let mut ahead = vec![0usize; n];
    for i in (0..n).rev() { ahead[i] = if marks[i] < 3 && i + 1 < n { ahead[i + 1] + 1 } else { 1 } }
    // A break after word k, before k + 1.
    let after = |k: usize| -> f64 {
        if k + 1 == n { return 0.0 }
        let at = if words[k + 1].n.is_some() { BREAK_AT_VERSE } else {
            [BREAK_WITHIN, BREAK_AT_COMMA, BREAK_AT_CLAUSE, BREAK_AT_SENTENCE][marks[k] as usize]
        };
        let lone = marks[k] < 3 && (back[k] <= 2 || ahead[k + 1] <= 2);
        at + if lone { BREAK_FRAGMENT } else { 0.0 }
    };
    let mut best = vec![f64::INFINITY; n + 1];
    let mut from = vec![0usize; n + 1];
    best[0] = 0.0;
    for j in 0..n {
        let mut length = 0usize;
        for i in (0..=j).rev() {
            length += lengths[i] + if i < j { 1 } else { 0 };
            if i < j && length as f64 > target * LONGEST { break }
            let apart = (length as f64 - target) / target;
            let cost = best[i] + UNEVEN * apart * apart + after(j);
            // The first found of the cheapest where two cost the same: the shortest last slide, as `i` runs down.
            if cost < best[j + 1] { best[j + 1] = cost; from[j + 1] = i }
        }
    }
    let mut ends = vec![];
    let mut j = n;
    while j > 0 { ends.push(j); j = from[j]; }
    ends.reverse();
    ends
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
        Some(Value::Array(xs)) if (1..=VERSES_PER_ITEM).contains(&xs.len()) => xs.iter().map(verse).collect::<R<_>>()?,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn verse(v: i64, t: &str) -> Verse { Verse { b: "JHN".into(), c: 3, v, t: t.into() } }

    /// A sentence of `n` words of four letters after `at`, ended by a full stop.
    fn sentence(n: usize, at: char) -> String {
        format!("{}.", (0..n).map(|k| format!("{at}{k:03}")).collect::<Vec<_>>().join(" "))
    }

    /// Each slide's words, verse numbers left out.
    fn words(slides: &[Vec<(Option<i64>, String)>]) -> Vec<Vec<String>> {
        slides.iter().map(|s| s.iter().flat_map(|(_, t)| t.split(' ').map(str::to_string)).collect()).collect()
    }

    #[test]
    fn breaks_between_sentences_rather_than_within_one_though_less_even() {
        let text = [sentence(30, 'a'), sentence(30, 'b'), sentence(20, 'c')].join(" ");

        let slides = words(&split(&[verse(1, &text)]));

        let ends: Vec<(&str, &str)> = slides.iter().map(|w| (w[0].as_str(), w[w.len() - 1].as_str())).collect();
        assert_eq!(ends, [("a000", "a029."), ("b000", "c019.")]);
    }

    #[test]
    fn leaves_no_one_or_two_words_of_a_sentence_apart_from_it() {
        let lengths = [7, 23, 11, 31, 5, 17, 29, 13, 9, 21, 27, 3, 19, 25, 15, 33, 6, 22];
        let text = lengths.iter().enumerate().map(|(i, n)| sentence(*n, (b'a' + i as u8) as char)).collect::<Vec<_>>().join(" ");

        let slides = words(&split(&[verse(1, &text)]));

        // A slide's words before its first sentence's end, and after its last one's.
        let head = |w: &[String]| w.iter().position(|x| x.ends_with('.')).map_or(w.len(), |p| p + 1);
        let tail = |w: &[String]| w.iter().rposition(|x| x.ends_with('.')).map_or(w.len(), |p| w.len() - 1 - p);
        let apart: Vec<String> = slides.iter().enumerate().flat_map(|(k, w)| {
            let h = (k > 0 && head(w) <= 2 && head(w) < w.len()).then(|| format!("head {k}"));
            let t = (k + 1 < slides.len() && (1..=2).contains(&tail(w))).then(|| format!("tail {k}"));
            h.into_iter().chain(t)
        }).collect();
        assert!(slides.len() > 2);
        assert_eq!(apart, Vec::<String>::new());
    }

    #[test]
    fn breaks_before_a_verse_rather_than_within_a_sentence() {
        let first = format!("{},", sentence(22, 'a').trim_end_matches('.'));
        let verses = [verse(1, &first), verse(2, &sentence(26, 'b')), verse(3, &sentence(30, 'c'))];

        let slides = split(&verses);

        assert_eq!(slides.iter().map(|s| s[0].0).collect::<Vec<_>>(), [Some(1), Some(3)]);
    }
}
