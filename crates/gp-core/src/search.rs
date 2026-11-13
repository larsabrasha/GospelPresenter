// packages/core/src/search.ts (spec 02, SONG-R30–R33): every term starts a word; accents are a fallback; ranked.
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

pub struct Prepared { title: String, title_f: String, first: String, first_f: String, all: String, all_f: String }

fn lower(s: &str) -> String {
    s.nfc().map(|c| { let mut l = c.to_lowercase(); match (l.next(), l.next()) { (Some(x), None) => x, _ => c } }).collect()
}

fn fold(s: &str) -> String {
    s.chars().map(|c| { let mut b = c.nfd().filter(|d| !is_combining_mark(*d)); match (b.next(), b.next()) { (Some(x), None) => x, _ => c } }).collect()
}

fn spaced(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if c.is_whitespace() { if !in_space { out.push(' ') } in_space = true } else { out.push(c); in_space = false }
    }
    out
}

fn first_prefix(text: &str, term: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(off) = text[from..].find(term) {
        let i = from + off;
        if i == 0 || !text[..i].chars().next_back().unwrap().is_alphanumeric() { return Some(i) }
        from = i + text[i..].chars().next().unwrap().len_utf8();
    }
    None
}

pub fn prepare(name: &str, author: &str, first_part: &str, lyrics: &str) -> Prepared {
    let title = spaced(lower(name).trim());
    let first = spaced(&lower(first_part));
    let all = spaced(&lower(&[name, author, lyrics].join("\n")));
    Prepared { title_f: fold(&title), first_f: fold(&first), all_f: fold(&all), title, first, all }
}

fn term_score(p: &Prepared, t: &str, f: &str) -> Option<f64> {
    if let Some(i) = first_prefix(&p.title, t) { return Some(10.0 + if i == 0 { 5.0 } else { 0.0 }) }
    if let Some(i) = first_prefix(&p.title_f, f) { return Some(8.0 + if i == 0 { 5.0 } else { 0.0 }) }
    if first_prefix(&p.first, t).is_some() { return Some(3.0) }
    if first_prefix(&p.first_f, f).is_some() { return Some(2.5) }
    if first_prefix(&p.all, t).is_some() { return Some(1.0) }
    if first_prefix(&p.all_f, f).is_some() { return Some(0.5) }
    None
}

fn bonus(p: &Prepared, ts: &[String]) -> f64 {
    let phrase = ts.join(" ");
    let folded = fold(&phrase);
    let mut b = 0.0;
    if p.title == phrase { b += 100.0 } else if p.title_f == folded { b += 90.0 }
    if ts.len() > 1 {
        if first_prefix(&p.title, &phrase).is_some() { b += 50.0 }
        else if first_prefix(&p.title_f, &folded).is_some() { b += 45.0 }
        else if first_prefix(&p.first, &phrase).is_some() { b += 25.0 }
        else if first_prefix(&p.first_f, &folded).is_some() { b += 22.0 }
        else if first_prefix(&p.all, &phrase).is_some() { b += 10.0 }
        else if first_prefix(&p.all_f, &folded).is_some() { b += 8.0 }
    }
    b
}

/// The indices of the songs that match every term, best first; all of them, in order, for a blank query.
pub fn rank(songs: &[Prepared], query: &str) -> Vec<usize> {
    let ts: Vec<String> = lower(query).split_whitespace().map(String::from).collect();
    if ts.is_empty() { return (0..songs.len()).collect() }
    let folded: Vec<String> = ts.iter().map(|t| fold(t)).collect();
    let mut hits: Vec<(usize, f64)> = Vec::new();
    'song: for (i, p) in songs.iter().enumerate() {
        let mut score = 0.0;
        for (t, f) in ts.iter().zip(&folded) {
            match term_score(p, t, f) { Some(s) => score += s, None => continue 'song }
        }
        hits.push((i, score + bonus(p, &ts)));
    }
    hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    hits.into_iter().map(|h| h.0).collect()
}
