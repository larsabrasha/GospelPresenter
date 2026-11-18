// A translation imported from a .zip of USX or USFM (spec 05 BIBLE-R3–R6; packages/core's bible-import.ts at
// 238d481b, proved against it by parity/views/bible-import.mjs). It runs on the device that imports, so a desktop host
// needs no internet and the server never parses a zip. A zip reader over DEFLATE (miniz_oxide), a small XML reader, and
// readers of the two formats. Where the TS split on JavaScript's white space, trimmed or cut, this does the same.
use crate::args::{is_js_space, js_trim, Obj, R};
use crate::files::{base64, cut, number, parse_int, utf8};
use serde_json::{json, Value};
use std::collections::HashMap;

/// 50 MiB, as the current app (BIBLE-R2).
const MAX_BYTES: usize = 52_428_800;

/// `bibleImportView` {data (the zip, base64)}: the translation {name, abbreviation, language, books}, or refused with
/// why: not-zip, compression, too-large, no-files, no-verses.
pub fn view(a: &Obj) -> R<Value> {
    let data = a.get("data").and_then(Value::as_str).and_then(base64).ok_or("invalid-args")?;
    import(&data)
}

// ------------------------------------------------------------------ zip

struct Entry<'a> { name: String, size: u32, method: u16, compressed: u32, local: u32, data: &'a [u8] }

/// A little-endian number at `o`; past the end, the bytes read as 0, as the TS reads `undefined`.
fn le(d: &[u8], o: usize, n: usize) -> u32 { (0..n).fold(0u32, |v, k| v | u32::from(d.get(o + k).copied().unwrap_or(0)) << (8 * k)) }

/// The entries of a zip file, from its central directory.
fn read_zip(data: &[u8]) -> R<Vec<Entry<'_>>> {
    let len = data.len();
    let end = if len < 22 { None } else { (len.saturating_sub(22 + 65_535)..=len - 22).rev().find(|&i| le(data, i, 4) == 0x0605_4b50) };
    let end = end.ok_or("not-zip")?;
    let count = le(data, end + 10, 2);
    let mut p = le(data, end + 16, 4) as usize;
    let mut entries = Vec::new();
    for _ in 0..count {
        if p + 46 > len || le(data, p, 4) != 0x0201_4b50 { return Err("not-zip".into()) }
        let name_len = le(data, p + 28, 2) as usize;
        let name = utf8(&data[(p + 46).min(len)..(p + 46 + name_len).min(len)]);
        entries.push(Entry { name, size: le(data, p + 24, 4), method: le(data, p + 10, 2) as u16, compressed: le(data, p + 20, 4), local: le(data, p + 42, 4), data });
        p += 46 + name_len + le(data, p + 30, 2) as usize + le(data, p + 32, 2) as usize;
    }
    Ok(entries)
}

impl Entry<'_> {
    /// Its bytes: stored as they are, or DEFLATE. A damaged stream is refused as `compression`.
    fn read(&self) -> R<Vec<u8>> {
        let (d, local) = (self.data, self.local as usize);
        if le(d, local, 4) != 0x0403_4b50 { return Err("not-zip".into()) }
        let start = (local + 30 + le(d, local + 26, 2) as usize + le(d, local + 28, 2) as usize).min(d.len());
        let raw = &d[start..(start + self.compressed as usize).min(d.len())];
        match self.method {
            0 => Ok(raw.to_vec()),
            8 => miniz_oxide::inflate::decompress_to_vec(raw).map_err(|_| "compression".into()),
            _ => Err("compression".into()),
        }
    }
    fn text(&self) -> R<String> { self.read().map(|b| utf8(&b)) }
}

// ------------------------------------------------------------------ XML

enum Node { El(El), Text(String) }
struct El { name: String, attrs: HashMap<String, String>, children: Vec<Node> }

/// `&amp;` and the four others, and `&#229;` `&#xE5;`; an entity it does not know stays as it is.
fn decode_entities(s: &str) -> String {
    if !s.contains('&') { return s.to_string() }
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut from = 0;
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'&' { i += 1; continue }
        let run = |k: usize, ok: fn(&u8) -> bool| b[k..].iter().take_while(|c| ok(c)).count();
        let hex = b.get(i + 1) == Some(&b'#') && matches!(b.get(i + 2), Some(b'x' | b'X'));
        let (len, value) = if hex && run(i + 3, u8::is_ascii_hexdigit) > 0 && b.get(i + 3 + run(i + 3, u8::is_ascii_hexdigit)) == Some(&b';') {
            let n = run(i + 3, u8::is_ascii_hexdigit);
            (n + 4, Some(code_point(u128::from_str_radix(&s[i + 3..i + 3 + n], 16).ok())))
        } else if b.get(i + 1) == Some(&b'#') && run(i + 2, u8::is_ascii_digit) > 0 && b.get(i + 2 + run(i + 2, u8::is_ascii_digit)) == Some(&b';') {
            let n = run(i + 2, u8::is_ascii_digit);
            (n + 3, Some(code_point(s[i + 2..i + 2 + n].parse::<u128>().ok())))
        } else {
            let n = run(i + 1, |c| c.is_ascii_alphanumeric() || *c == b'_');
            if n > 0 && b.get(i + 1 + n) == Some(&b';') {
                let named = match &s[i + 1..i + 1 + n] { "amp" => Some("&"), "lt" => Some("<"), "gt" => Some(">"), "quot" => Some("\""), "apos" => Some("'"), _ => None };
                (n + 2, Some(named.map_or_else(|| s[i..i + n + 2].to_string(), str::to_string)))
            } else { (0, None) }
        };
        match value {
            Some(v) => { out.push_str(&s[from..i]); out.push_str(&v); i += len; from = i }
            None => i += 1,
        }
    }
    out.push_str(&s[from..]);
    out
}

/// A numeric entity's character: none for 0 or past U+10FFFF, U+FFFD for a surrogate (the TS keeps half a pair).
fn code_point(n: Option<u128>) -> String {
    match n { Some(n) if n > 0 && n <= 0x10ffff => char::from_u32(n as u32).unwrap_or('\u{fffd}').to_string(), _ => String::new() }
}

/// The attributes of a start tag's body after its name: `/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g`.
fn attributes(s: &str) -> HashMap<String, String> {
    let name_char = |c: char| !is_js_space(c) && c != '=';
    let mut attrs = HashMap::new();
    let mut k = 0;
    while k < s.len() {
        let rest = &s[k..];
        let step = rest.chars().next().map_or(1, char::len_utf8);
        let name_len: usize = rest.chars().take_while(|&c| name_char(c)).map(char::len_utf8).sum();
        if name_len > 0 {
            let after = rest[name_len..].trim_start_matches(is_js_space);
            if let Some(v) = after.strip_prefix('=') {
                let v = v.trim_start_matches(is_js_space);
                if let Some(q) = v.chars().next().filter(|q| *q == '"' || *q == '\'') {
                    if let Some(close) = v[1..].find(q) {
                        attrs.insert(rest[..name_len].to_string(), decode_entities(&v[1..1 + close]));
                        k = s.len() - v.len() + 1 + close + 1;
                        continue;
                    }
                }
            }
        }
        k += step;
    }
    attrs
}

/// XML into elements and text: enough for USX and DBL metadata (no namespaces or DTDs), as the TS `parseXml`.
fn parse_xml(xml: &str) -> El {
    let mut stack = vec![El { name: "#document".into(), attrs: HashMap::new(), children: vec![] }];
    let find = |from: usize, pat: &str| xml[from.min(xml.len())..].find(pat).map(|p| p + from);
    let mut i = 0;
    while i < xml.len() {
        let Some(lt) = find(i, "<") else { stack.last_mut().unwrap().children.push(Node::Text(decode_entities(&xml[i..]))); break };
        if lt > i { stack.last_mut().unwrap().children.push(Node::Text(decode_entities(&xml[i..lt]))) }
        let next = xml.as_bytes().get(lt + 1).copied();
        if xml[lt..].starts_with("<!--") {
            i = find(lt + 4, "-->").map_or(xml.len(), |e| e + 3);
        } else if xml[lt..].starts_with("<![CDATA[") {
            let e = find(lt + 9, "]]>");
            stack.last_mut().unwrap().children.push(Node::Text(xml[lt + 9..e.unwrap_or(xml.len())].to_string()));
            i = e.map_or(xml.len(), |e| e + 3);
        } else if next == Some(b'?') || next == Some(b'!') {
            i = find(lt, ">").map_or(xml.len(), |e| e + 1);
        } else if next == Some(b'/') {
            let e = find(lt, ">");
            let name = js_trim(&xml[(lt + 2).min(e.unwrap_or(xml.len()))..e.unwrap_or(xml.len())]);
            // Close up to the matching element; a stray end tag is ignored.
            if let Some(at) = stack.iter().rposition(|el| el.name == name).filter(|&at| at > 0) {
                while stack.len() > at { let el = stack.pop().unwrap(); stack.last_mut().unwrap().children.push(Node::El(el)) }
            }
            i = e.map_or(xml.len(), |e| e + 1);
        } else {
            // A start tag: its end outside quoted attribute values.
            let mut j = lt + 1;
            let mut quote = None;
            for (k, c) in xml[lt + 1..].char_indices() {
                j = lt + 1 + k;
                match quote { Some(q) if c == q => quote = None, Some(_) => {}, None if c == '"' || c == '\'' => quote = Some(c), None if c == '>' => break, None => {} }
                j = lt + 1 + k + c.len_utf8();
            }
            let mut body = &xml[lt + 1..j];
            let self_closing = body.ends_with('/');
            if self_closing { body = &body[..body.len() - 1] }
            let name_len: usize = body.chars().take_while(|&c| !is_js_space(c) && c != '/' && c != '>').map(char::len_utf8).sum();
            let el = El { name: body[..name_len].to_string(), attrs: attributes(&body[name_len..]), children: vec![] };
            if self_closing { stack.last_mut().unwrap().children.push(Node::El(el)) } else { stack.push(el) }
            i = j + 1;
        }
    }
    while stack.len() > 1 { let el = stack.pop().unwrap(); stack.last_mut().unwrap().children.push(Node::El(el)) }
    stack.pop().unwrap()
}

impl El {
    fn elements(&self) -> impl Iterator<Item = &El> { self.children.iter().filter_map(|c| match c { Node::El(e) => Some(e), Node::Text(_) => None }) }
    fn child(&self, name: &str) -> Option<&El> { self.elements().find(|e| e.name == name) }
    fn text(&self) -> String { self.children.iter().map(|c| match c { Node::Text(t) => t.clone(), Node::El(e) => e.text() }).collect() }
}

// ------------------------------------------------------------------ verses

type Verse = (f64, f64, String);
struct Book { code: String, verses: Vec<Verse> }

/// Every run of JavaScript's white space as one space (`/\s+/g`).
fn spaced(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for c in s.chars() {
        if is_js_space(c) { if !in_space { out.push(' ') } in_space = true } else { out.push(c); in_space = false }
    }
    out
}

/// Collects verse text: fragments joined as they stand, a paragraph or line break a space, white space runs one space.
#[derive(Default)]
struct Verses { chapter: Option<f64>, current: Option<(f64, f64, String)>, verses: Vec<Verse> }

impl Verses {
    fn start_chapter(&mut self, n: f64) { self.end_verse(); self.chapter = Some(n) }
    /// `number` may be a range ("5-6"): the verse is the first number (BIBLE-R6).
    fn start_verse(&mut self, number: &str) {
        self.end_verse();
        let v = parse_int(number);
        if let Some(c) = self.chapter.filter(|_| v.is_finite()) { self.current = Some((c, v, String::new())) }
    }
    fn end_verse(&mut self) {
        if let Some((c, v, t)) = self.current.take() { self.verses.push((c, v, js_trim(&spaced(&t)).to_string())) }
    }
    fn text(&mut self, s: &str) { if let Some(cur) = &mut self.current { cur.2.push_str(s) } }
    fn space(&mut self) { self.text(" ") }
}

/// Paragraph styles that hold headings and metadata, not verse text (BIBLE-R6, plus psalm titles and the like).
const NON_CONTENT_STYLES: &[&str] = &[
    "ide", "rem", "h", "h1", "h2", "h3", "toc1", "toc2", "toc3", "toca1", "toca2", "toca3", "mt", "mt1", "mt2", "mt3", "mt4", "mte",
    "mte1", "mte2", "s", "s1", "s2", "s3", "s4", "sr", "ms", "ms1", "ms2", "ms3", "mr", "r", "sp", "d", "qa", "cl", "cd",
];

/// Book codes of front and back matter: never Bible text.
const PERIPHERALS: &[&str] = &["FRT", "BAK", "OTH", "INT", "CNC", "GLO", "TDX", "NDX"];

fn book_code(code: String) -> Option<String> {
    (code.len() == 3 && code.bytes().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())).then_some(code)
}

/// One USX file (USX 2 or 3) to its book. Text before the first chapter, headings, notes and figures are left out.
fn parse_usx(xml: &str) -> Option<Book> {
    let doc = parse_xml(xml);
    let usx = doc.elements().find(|e| e.name == "usx")?;
    let code = usx.child("book").and_then(|b| b.attrs.get("code")).map_or(String::new(), |c| c.to_uppercase());
    let mut out = Verses::default();
    fn walk(el: &El, out: &mut Verses) {
        for node in &el.children {
            match node {
                Node::Text(t) => out.text(&t.replace('\n', " ")),
                Node::El(e) if e.name == "verse" => {
                    if let Some(n) = e.attrs.get("number") { out.start_verse(n) } else if e.attrs.contains_key("eid") { out.end_verse() }
                }
                Node::El(e) if matches!(e.name.as_str(), "note" | "figure" | "sidebar") => {}
                Node::El(e) => walk(e, out),
            }
        }
    }
    let mut in_chapters = false;
    for el in usx.elements() {
        if el.name == "chapter" {
            if let Some(n) = el.attrs.get("number") { in_chapters = true; out.start_chapter(parse_int(n)) }
        } else if !in_chapters {
            continue;
        } else if el.name == "para" {
            if NON_CONTENT_STYLES.contains(&el.attrs.get("style").map_or("", String::as_str)) { continue }
            out.space();
            walk(el, &mut out);
            out.space();
        } else if el.name == "table" || el.name == "list" {
            out.space();
            walk(el, &mut out);
            out.space();
        }
    }
    out.end_verse();
    book_code(code).map(|code| Book { code, verses: out.verses })
}

/// Character markers whose text is not the verse's (footnotes, cross-references), and those whose text is.
const USFM_SKIP_SPANS: &[&str] = &["f", "fe", "ef", "x", "ex", "fig", "ca", "va", "vp", "rq"];
const USFM_CHARACTER: &[&str] = &[
    "add", "bk", "dc", "k", "nd", "ord", "pn", "png", "addpn", "qt", "sig", "sls", "tl", "wj", "em", "bd", "it", "bdit", "no", "sc", "sup",
    "w", "wg", "wh", "wa", "ior", "iqt", "jmp", "qs", "qac", "rb", "pro", "ndx", "lit", "litl", "liv",
];

/// `\w word|strong="H1"\w*`: the attributes after the bar are not text (`/\|[^\\]*(?=\\\+?[a-z0-9]+\*)/gi`).
fn without_attributes(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut from = 0;
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'|' {
            let slash = b[i..].iter().position(|&c| c == b'\\').map(|p| p + i);
            if let Some(k) = slash {
                let m = k + 1 + usize::from(b.get(k + 1) == Some(&b'+'));
                let n = b[m..].iter().take_while(|c| c.is_ascii_alphanumeric()).count();
                if n > 0 && b.get(m + n) == Some(&b'*') { out.push_str(&s[from..i]); from = k; i = k; continue }
            }
        }
        i += 1;
    }
    out.push_str(&s[from..]);
    out
}

/// One USFM file to its book (BIBLE-R6): verse text without footnotes, cross-references and headings.
fn parse_usfm(usfm: &str) -> Option<Book> {
    let text = without_attributes(usfm);
    let b = text.as_bytes();
    let mut out = Verses::default();
    let mut code = String::new();
    let mut skip_paragraph = false;
    let mut skip_span: Option<String> = None;
    let mut pending: Option<&str> = None;
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' {
            // Plain text, up to the next backslash.
            let end = b[i..].iter().position(|&c| c == b'\\').map_or(b.len(), |p| p + i);
            let mut s = &text[i..end];
            i = end;
            if let Some(p) = pending.take() {
                let lead = s.len() - s.trim_start_matches(is_js_space).len();
                let value_len: usize = s[lead..].chars().take_while(|&c| !is_js_space(c)).map(char::len_utf8).sum();
                let value = &s[lead..lead + value_len];
                match p {
                    "chapter" => { out.start_chapter(parse_int(value)); skip_paragraph = false }
                    "verse" => { out.start_verse(value); skip_paragraph = false }
                    _ => code = value.to_uppercase(),
                }
                if value_len > 0 { s = &s[lead + value_len..] }
                if p == "id" { s = "" }
            }
            if !skip_paragraph && skip_span.is_none() { out.text(&spaced(s)) }
            continue;
        }
        // A marker: `\\(\+?)([a-z]+[0-9]*(?:-[se])?)(\*|[ \t]?)`, case aside; a backslash that starts none is dropped.
        let mut k = i + 1;
        if b.get(k) == Some(&b'+') { k += 1 }
        let letters = b[k..].iter().take_while(|c| c.is_ascii_alphabetic()).count();
        if letters == 0 { i += 1; continue }
        let mut m = k + letters;
        m += b[m..].iter().take_while(|c| c.is_ascii_digit()).count();
        if b.get(m) == Some(&b'-') && matches!(b.get(m + 1), Some(b's' | b'S' | b'e' | b'E')) { m += 2 }
        let marker = text[k..m].to_ascii_lowercase();
        let close = b.get(m) == Some(&b'*');
        i = if close || matches!(b.get(m), Some(b' ' | b'\t')) { m + 1 } else { m };
        if let Some(span) = &skip_span {
            if close && marker == *span { skip_span = None }
            continue;
        }
        if close { continue } // the end of a character style: its text is already in
        if USFM_SKIP_SPANS.contains(&marker.as_str()) { skip_span = Some(marker); continue }
        let letters_after = |p: char| marker.strip_prefix(p).is_some_and(|r| !r.is_empty() && r.bytes().all(|c| c.is_ascii_lowercase()));
        if USFM_CHARACTER.contains(&marker.as_str()) || letters_after('f') || letters_after('x') { continue }
        match marker.as_str() {
            "c" => pending = Some("chapter"),
            "v" => pending = Some("verse"),
            "id" => { pending = Some("id"); skip_paragraph = true }
            _ => {
                // A paragraph marker: a break between words, and maybe a heading to leave out.
                out.space();
                let intro = marker.strip_prefix('i').is_some_and(|r| {
                    let l = r.bytes().take_while(u8::is_ascii_lowercase).count();
                    r.bytes().skip(l).all(|c| c.is_ascii_digit())
                });
                skip_paragraph = NON_CONTENT_STYLES.contains(&marker.as_str()) || ["id", "usfm", "sts", "cp"].contains(&marker.as_str()) || intro;
            }
        }
    }
    out.end_verse();
    book_code(code).map(|code| Book { code, verses: out.verses })
}

// ------------------------------------------------------------------ the zip

fn dir_of(path: &str) -> &str { &path[..path.rfind('/').map_or(0, |p| p + 1)] }
fn file_of(path: &str) -> String { path.rsplit('/').next().unwrap_or(path).to_lowercase() }

/// A Unicode upper-case letter (Lu): Rust's `is_uppercase` without Other_Uppercase (Roman numerals, circled letters).
fn upper_letter(c: char) -> bool {
    c.is_uppercase() && !matches!(c as u32, 0x2160..=0x216f | 0x24b6..=0x24cf | 0x1f130..=0x1f149 | 0x1f150..=0x1f169 | 0x1f170..=0x1f189)
}

/// The initials of a title's capitalised words, two or more ("Svenska Folkbibeln" SF).
fn initials(title: &str) -> Option<String> {
    let letters: Vec<char> = title.split(is_js_space).filter_map(|w| w.chars().next()).filter(|&c| upper_letter(c))
        .map(|c| if c.len_utf16() > 1 { '\u{fffd}' } else { c }).collect();
    (letters.len() >= 2).then(|| letters.into_iter().collect())
}

/// `/<title[^>]*>([\s\S]*?)<\/title>/i`: the first title of an HTML page.
fn html_title(html: &str) -> Option<&str> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open = start + lower[start..].find('>')? + 1;
    let close = open + lower[open..].find("</title>")?;
    Some(&html[open..close])
}

/// The canonical order of two books (BIBLE-R9): the 66 books first, the others after by code.
fn compare_books(x: &str, y: &str) -> std::cmp::Ordering {
    let place = |c: &str| crate::bible_books::canon_index(c).unwrap_or(usize::MAX);
    place(x).cmp(&place(y)).then_with(|| x.cmp(y))
}

/// `a - b || c - d` as a sort reads it: NaN and 0 alike are no answer.
fn by_verse(x: &Verse, y: &Verse) -> std::cmp::Ordering {
    let d = x.0 - y.0;
    let d = if d == 0.0 || d.is_nan() { x.1 - y.1 } else { d };
    d.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
}

/// A translation from a zip (BIBLE-R3): DBL metadata (`metadata.xml`) or eBible's `copr.htm` for its name, then USX
/// books from `USX_1/` or `USX_2/` beside the metadata, else any `.usx`, else every `.usfm`/`.sfm`. Books without
/// verses and front or back matter are left out; books come in canonical order, their verses by chapter and verse.
/// Files are taken in the order of their names, the first of two with one book's code kept: by code unit, where the TS
/// compared them in the language's order (`localeCompare`), which differs only for names of other cases or symbols.
fn import(data: &[u8]) -> R<Value> {
    if data.len() > MAX_BYTES { return Err("too-large".into()) }
    let entries: Vec<Entry> = read_zip(data)?.into_iter().filter(|e| !e.name.ends_with('/') && e.size > 0).collect();

    let (mut name, mut abbreviation, mut language) = ("Unknown Bible".to_string(), "UNKNOWN".to_string(), None::<String>);
    let metadata = entries.iter().find(|e| file_of(&e.name) == "metadata.xml");
    let root = metadata.map_or("", |m| dir_of(&m.name)).to_string();
    if let Some(m) = metadata {
        let doc = parse_xml(&m.text()?);
        let meta = doc.elements().next();
        let id = meta.and_then(|m| m.child("identification"));
        let pick = |names: [&str; 2]| names.iter().filter_map(|n| id.and_then(|i| i.child(n))).map(|e| js_trim(&e.text()).to_string()).find(|t| !t.is_empty());
        if let Some(n) = pick(["nameLocal", "name"]) { name = n }
        if let Some(a) = pick(["abbreviationLocal", "abbreviation"]) { abbreviation = a }
        language = meta.and_then(|m| m.child("language")).and_then(|l| l.child("iso")).map(|i| js_trim(&i.text()).to_string()).filter(|l| !l.is_empty());
    } else if let Some(copr) = entries.iter().find(|e| file_of(&e.name) == "copr.htm") {
        let page = copr.text()?;
        let title = html_title(&page).map(|t| js_trim(&spaced(t)).to_string()).filter(|t| !t.is_empty());
        if let Some(title) = title {
            if let Some(i) = initials(&title) { abbreviation = i }
            name = title;
        }
    }

    let usx_under = |dir: &str| -> Vec<&Entry> { entries.iter().filter(|e| e.name.starts_with(dir) && e.name.to_lowercase().ends_with(".usx")).collect() };
    let mut files = usx_under(&format!("{root}USX_1/"));
    if files.is_empty() { files = usx_under(&format!("{root}USX_2/")) }
    if files.is_empty() { files = usx_under("") }
    let usx = !files.is_empty();
    if !usx { files = entries.iter().filter(|e| { let l = e.name.to_lowercase(); l.ends_with(".usfm") || l.ends_with(".sfm") }).collect() }
    if files.is_empty() { return Err("no-files".into()) }
    files.sort_by(|a, b| a.name.encode_utf16().cmp(b.name.encode_utf16()));

    let mut books: Vec<Book> = Vec::new();
    for file in files {
        let text = file.text()?;
        let Some(book) = (if usx { parse_usx(&text) } else { parse_usfm(&text) }) else { continue };
        if !book.verses.is_empty() && !PERIPHERALS.contains(&book.code.as_str()) && !books.iter().any(|b| b.code == book.code) { books.push(book) }
    }
    if books.is_empty() { return Err("no-verses".into()) }
    books.sort_by(|a, b| compare_books(&a.code, &b.code));
    let books: Vec<Value> = books.into_iter().map(|mut b| {
        b.verses.sort_by(by_verse);
        json!({ "code": b.code, "verses": b.verses.into_iter().map(|(c, v, t)| json!([number(c), number(v), t])).collect::<Vec<_>>() })
    }).collect();
    Ok(json!({ "name": cut(name, 200), "abbreviation": cut(abbreviation, 50), "language": language.map(|l| cut(l, 20)), "books": books }))
}
