// ProPresenter 7 `.pro` files to songs (spec 02 "Import (ProPresenter 7)", SONG-R35–R43; packages/core's
// propresenter.ts at 238d481b, proved against it by parity/views/propresenter.mjs). A `.pro` file is a protobuf
// message (rv.data.Presentation); only the fields for the title, the CCLI block, the groups, their slides' text and
// the arrangements are read, with a small reader of the wire format. A slide's text is RTF, made plain here. The text
// is worked on as UTF-16 units, as the web's strings are, so lengths, cuts and `\uN` escapes come out the same; a unit
// that pairs with none becomes U+FFFD at the end, as JSON from the core cannot carry it.
use crate::args::{is_js_space, Obj, R};
use crate::mutators::songs::{ARRANGEMENTS_PER_SONG, PARTS_LIMIT};
use serde_json::{json, Value};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

/// The lengths an imported value is cut to rather than refused (SONG-R41).
const NAME: usize = 200;
const AUTHOR: usize = 200;
const PUBLISHER: usize = 200;
const CCLI: usize = 20;
const LABEL: usize = 50;
const CONTENT: usize = 5000;
const ARRANGEMENT_NAME: usize = 100;

/// `proPresenterSongView` {data (the file, base64), fileName}: the song the file holds, or null when it has no slide
/// text or cannot be read (SONG-R40).
pub fn view(a: &Obj) -> R<Value> {
    let data = a.get("data").and_then(Value::as_str).and_then(base64).ok_or("invalid-args")?;
    let file_name = a.get("fileName").and_then(Value::as_str);
    Ok(parse(&data, file_name).unwrap_or(Value::Null))
}

// ------------------------------------------------------------------ the wire format

enum Val<'a> { Int(u128), Bytes(&'a [u8]) }
struct Field<'a> { no: u128, val: Val<'a> }
type Fields<'a> = Vec<Field<'a>>;
/// A message that cannot be read: the whole file is then no song.
struct Bad;
type P<T> = Result<T, Bad>;

/// The fields of one message, in file order; a malformed message is `Bad`.
fn fields(buf: &[u8]) -> P<Fields<'_>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    let varint = |at: &mut usize| -> P<u128> {
        let mut v: u128 = 0;
        let mut shift = 0u32;
        loop {
            if *at >= buf.len() || shift > 63 { return Err(Bad) }
            let b = buf[*at];
            *at += 1;
            v |= u128::from(b & 0x7f) << shift;
            if b & 0x80 == 0 { return Ok(v) }
            shift += 7;
        }
    };
    while at < buf.len() {
        let key = varint(&mut at)?;
        let (no, wire) = (key >> 3, key & 7);
        match wire {
            0 => { let v = varint(&mut at)?; out.push(Field { no, val: Val::Int(v) }) }
            2 => {
                let len = varint(&mut at)?;
                if (at as u128) + len > buf.len() as u128 { return Err(Bad) }
                let end = at + len as usize;
                out.push(Field { no, val: Val::Bytes(&buf[at..end]) });
                at = end;
            }
            1 => at += 8,
            5 => at += 4,
            _ => return Err(Bad),
        }
        if at > buf.len() { return Err(Bad) }
    }
    Ok(out)
}

fn bytes_of<'a>(fs: &[Field<'a>], no: u128) -> Vec<&'a [u8]> {
    fs.iter().filter(|f| f.no == no).filter_map(|f| match f.val { Val::Bytes(b) => Some(b), Val::Int(_) => None }).collect()
}
fn message_of<'a>(fs: &[Field<'a>], no: u128) -> P<Option<Fields<'a>>> {
    match bytes_of(fs, no).first() { Some(b) => fields(b).map(Some), None => Ok(None) }
}
fn string_of(fs: Option<&[Field]>, no: u128) -> Option<String> {
    fs.and_then(|fs| bytes_of(fs, no).first().map(|b| utf8(b)))
}
fn uint_of(fs: &[Field], no: u128) -> u128 {
    fs.iter().find_map(|f| match f.val { Val::Int(v) if f.no == no => Some(v), _ => None }).unwrap_or(0)
}
/// A `UUID` message's string.
fn uuid_of(fs: Option<&[Field]>, no: u128) -> P<Option<String>> {
    let Some(fs) = fs else { return Ok(None) };
    Ok(string_of(message_of(fs, no)?.as_deref(), 1))
}

/// UTF-8 as the web's TextDecoder reads it: a byte order mark dropped, a byte that is no character U+FFFD.
fn utf8(b: &[u8]) -> String {
    String::from_utf8_lossy(b.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(b)).into_owned()
}

// ------------------------------------------------------------------ text

type U16 = Vec<u16>;
fn units(s: &str) -> U16 { s.encode_utf16().collect() }
fn text(u: &[u16]) -> String { String::from_utf16_lossy(u) }
fn is_space(u: u16) -> bool { char::from_u32(u32::from(u)).is_some_and(is_js_space) }

/// Trimmed as String.prototype.trim and NFC-normalised (macOS stores names decomposed); blank is None (SONG-R37).
fn clean(value: Option<&str>) -> Option<String> {
    let v = crate::args::js_trim(value?);
    if v.is_empty() { None } else { Some(v.nfc().collect()) }
}

/// At most `max` UTF-16 units, as `slice` cuts.
fn cut(s: String, max: usize) -> String {
    let u = units(&s);
    if u.len() > max { text(&u[..max]) } else { s }
}

/// ProPresenter's default name, with the copy suffix it adds (SONG-R36): `/^untitled([ _-]*\d+)?$/i`.
fn placeholder(v: &str) -> bool {
    let b = v.as_bytes();
    if b.len() < 8 || !b[..8].eq_ignore_ascii_case(b"untitled") { return false }
    let rest = &b[8..];
    if rest.is_empty() { return true }
    let digits = rest.iter().rev().take_while(|c| c.is_ascii_digit()).count();
    digits > 0 && rest[..rest.len() - digits].iter().all(|c| matches!(c, b' ' | b'_' | b'-'))
}

fn first_real_title(candidates: [Option<&str>; 3]) -> Option<String> {
    candidates.into_iter().filter_map(clean).find(|v| !placeholder(v))
}

/// Windows-1252's bytes 0x80–0x9F; the rest are Latin-1, the same code points.
const CP1252_HIGH: [u16; 32] = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

fn windows1252(byte: u16) -> u16 { if (0x80..0xa0).contains(&byte) { CP1252_HIGH[usize::from(byte - 0x80)] } else { byte } }

const BACKSLASH: u16 = b'\\' as u16;
const NL: u16 = b'\n' as u16;
fn at(s: &[u16], i: usize) -> u16 { s.get(i).copied().unwrap_or(0) }
fn is(s: &[u16], i: usize, ascii: &str) -> bool { ascii.bytes().enumerate().all(|(k, c)| at(s, i + k) == u16::from(c)) }
fn digit(u: u16) -> bool { (u16::from(b'0')..=u16::from(b'9')).contains(&u) }
fn hex(u: u16) -> Option<u16> { char::from_u32(u32::from(u)).and_then(|c| c.to_digit(16)).map(|d| d as u16) }

/// The header groups whose text is not the slide's: fonts, colours, styles, and `{\*…}` destinations, each removed to
/// its matching brace (`/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)/g`).
fn without_header_groups(rtf: &[u16]) -> U16 {
    let starts = |i: usize| is(rtf, i, "{\\") && ["fonttbl", "colortbl", "stylesheet", "info", "*"].iter().any(|w| is(rtf, i + 2, w));
    let mut out = U16::new();
    let mut from = 0usize;
    let mut k = 0usize;
    while k < rtf.len() {
        if !starts(k) { k += 1; continue }
        out.extend_from_slice(&rtf[from..k]);
        let mut depth = 0i64;
        let mut i = k;
        while i < rtf.len() {
            let u = rtf[i];
            if u == BACKSLASH { i += 1 } else if u == u16::from(b'{') { depth += 1 } else if u == u16::from(b'}') { depth -= 1; if depth == 0 { break } }
            i += 1;
        }
        from = i + 1;
        k = from;
    }
    if from < rtf.len() { out.extend_from_slice(&rtf[from..]) }
    out
}

/// `\'hh` as its Windows-1252 character.
fn hex_escapes(s: &[u16]) -> U16 {
    let mut out = U16::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i] == BACKSLASH && at(s, i + 1) == u16::from(b'\'') {
            if let (Some(h), Some(l)) = (hex(at(s, i + 2)), hex(at(s, i + 3))) { out.push(windows1252(h * 16 + l)); i += 4; continue }
        }
        out.push(s[i]);
        i += 1;
    }
    out
}

/// A run of ASCII digits from `i`, with `-` first where `minus` allows it: its end, and its value as Number reads it.
fn number(s: &[u16], i: usize, minus: bool) -> Option<(usize, f64)> {
    let start = if minus && at(s, i) == u16::from(b'-') { i + 1 } else { i };
    let end = (start..s.len()).find(|&j| !digit(s[j])).unwrap_or(s.len());
    if end == start { return None }
    let t: String = s[i..end].iter().map(|&u| u as u8 as char).collect();
    Some((end, t.parse::<f64>().ok()?))
}

/// ToUint16, as String.fromCharCode takes its number.
fn to_uint16(n: f64) -> u16 {
    if !n.is_finite() { return 0 }
    let r = n.trunc() % 65536.0;
    (if r < 0.0 { r + 65536.0 } else { r }) as u16
}

/// `\uN` escapes as their characters (U+2028 and U+2029, which Cocoa writes for a line break, as one), each followed by
/// the `\ucN` fallback characters it says, which are dropped (`\uc1` unless set): `/\\uc(\d+)|\\u(-?\d+) ?/g`.
fn unicode_escapes(s: &[u16]) -> U16 {
    let mut out = U16::with_capacity(s.len());
    let mut fallback = 1f64;
    let mut from = 0usize;
    let mut k = 0usize;
    while k < s.len() {
        if !is(s, k, "\\u") { k += 1; continue }
        if at(s, k + 2) == u16::from(b'c') {
            if let Some((end, n)) = number(s, k + 3, false) {
                out.extend_from_slice(&s[from..end]); // the control word stays, removed with the others
                fallback = n;
                from = end;
                k = end;
                continue;
            }
        }
        let Some((mut end, n)) = number(s, k + 2, true) else { k += 1; continue };
        if at(s, end) == u16::from(b' ') { end += 1 }
        out.extend_from_slice(&s[from..k]);
        let code = if n < 0.0 { n + 65536.0 } else { n };
        out.push(if code == 8232.0 || code == 8233.0 { NL } else { to_uint16(code) });
        let skip = (end as f64 + fallback).min(s.len() as f64);
        from = skip as usize;
        k = from;
    }
    out.extend_from_slice(&s[from.min(s.len())..]);
    out
}

/// Control words gone: `/\\[a-z]+-?[0-9]*\s?/g`.
fn without_control_words(s: &[u16]) -> U16 {
    let mut out = U16::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let letter = |u: u16| (u16::from(b'a')..=u16::from(b'z')).contains(&u);
        if s[i] == BACKSLASH && letter(at(s, i + 1)) {
            let mut j = i + 1;
            while j < s.len() && letter(s[j]) { j += 1 }
            if at(s, j) == u16::from(b'-') { j += 1 }
            while j < s.len() && digit(s[j]) { j += 1 }
            if j < s.len() && is_space(s[j]) { j += 1 }
            i = j;
            continue;
        }
        out.push(s[i]);
        i += 1;
    }
    out
}

/// A backslash at a line's end a line break: `/\\\r?\n/g`.
fn line_breaks(s: &[u16]) -> U16 {
    let mut out = U16::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i] == BACKSLASH && at(s, i + 1) == u16::from(b'\r') && at(s, i + 2) == NL { out.push(NL); i += 3; continue }
        if s[i] == BACKSLASH && at(s, i + 1) == NL { out.push(NL); i += 2; continue }
        out.push(s[i]);
        i += 1;
    }
    out
}

fn trim_units(s: &[u16], start: bool) -> &[u16] {
    let end = s.iter().rposition(|&u| !is_space(u)).map_or(0, |p| p + 1);
    let s = &s[..end];
    if start { &s[s.iter().position(|&u| !is_space(u)).unwrap_or(s.len())..] } else { s }
}

/// A slide's RTF as plain text, as 2.0 makes it (`rtfToPlainText`): the header groups gone, `\'hh` as Windows-1252,
/// the text after the last `\pard` line, `\uN` escapes, control words and braces gone, a backslash at a line's end a
/// line break, spaces at a line's end gone, at most one blank line between lines, trimmed.
fn rtf_to_plain_text(rtf: &[u16]) -> U16 {
    let s = hex_escapes(&without_header_groups(rtf));
    let lines: Vec<&[u16]> = s.split(|&u| u == NL).collect();
    let last_pard = lines.iter().rposition(|l| l.windows(5).any(|w| w == units("\\pard").as_slice()));
    let s = lines[last_pard.map_or(0, |p| p + 1)..].join(&NL);
    let s = unicode_escapes(&s);
    let s: U16 = without_control_words(&s).into_iter().filter(|&u| u != u16::from(b'{') && u != u16::from(b'}')).collect();
    let s = line_breaks(&s);
    let s = s.split(|&u| u == NL).map(|l| trim_units(l, false)).collect::<Vec<_>>().join(&NL);
    let mut out = U16::with_capacity(s.len());
    let mut run = 0;
    for u in s {
        run = if u == NL { run + 1 } else { 0 };
        if run <= 2 { out.push(u) }
    }
    trim_units(&out, true).to_vec()
}

/// The first text element of a cue whose RTF has text (SONG-R38).
fn slide_text(cue: &[Field]) -> P<Option<String>> {
    for action in bytes_of(cue, 10) {
        let a = fields(action)?;
        let Some(m23) = message_of(&a, 23)? else { continue };
        let Some(m2) = message_of(&m23, 2)? else { continue };
        let Some(slide) = message_of(&m2, 1)? else { continue };
        for element in bytes_of(&slide, 1) {
            let e = fields(element)?;
            let Some(m1) = message_of(&e, 1)? else { continue };
            let Some(m13) = message_of(&m1, 13)? else { continue };
            let Some(rtf) = bytes_of(&m13, 5).first().copied() else { continue };
            if rtf.is_empty() { continue }
            let source = utf8(rtf);
            if !source.starts_with("{\\rtf") { continue }
            let plain = rtf_to_plain_text(&units(&source));
            if !plain.is_empty() { return Ok(Some(text(&plain).nfc().collect())) }
        }
    }
    Ok(None)
}

/// A whole number as JavaScript writes it (Number::toString): its shortest digits, below 10²¹ filled out with zeros,
/// else with an exponent.
fn js_number(n: u128) -> String {
    let f = n as f64;
    let e = format!("{f:e}"); // shortest digits, "5.902958103587057e19"
    let (mantissa, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let exp: usize = exp.parse().unwrap_or(0);
    if exp >= 21 { return format!("{mantissa}e+{exp}") }
    let digits = mantissa.replace('.', "");
    format!("{digits:0<width$}", width = exp + 1)
}

/// A `.pro` file as a song (`parseProPresenter`): the title the first real one of the file's own name for the
/// presentation, `fileName` and the CCLI title, else "Untitled" (SONG-R36); one part per slide with text, group by
/// group, labelled with the group's name; an arrangement of groups one of all their parts (SONG-R39); values cut to
/// the limits, and to the first 50 parts and 10 arrangements (SONG-R41, SONG-R8, SONG-R9). None when unreadable.
fn parse(data: &[u8], file_name: Option<&str>) -> Option<Value> { song(data, file_name).ok().flatten() }

fn song(data: &[u8], file_name: Option<&str>) -> P<Option<Value>> {
    let p = fields(data)?;
    let ccli_block = message_of(&p, 14)?;
    let ccli_number = ccli_block.as_deref().map_or(0, |c| uint_of(c, 6));
    let name = first_real_title([string_of(Some(&p), 3).as_deref(), file_name, string_of(ccli_block.as_deref(), 3).as_deref()])
        .unwrap_or_else(|| "Untitled".into());

    let mut cues: HashMap<String, Fields> = HashMap::new();
    for b in bytes_of(&p, 13) {
        let cue = fields(b)?;
        if let Some(id) = uuid_of(Some(&cue), 1)?.filter(|id| !id.is_empty()) { cues.insert(id, cue); }
    }
    let mut parts: Vec<(Option<String>, String)> = Vec::new();
    let mut parts_of_group: HashMap<String, Vec<usize>> = HashMap::new();
    for b in bytes_of(&p, 12) {
        let cue_group = fields(b)?;
        let group = message_of(&cue_group, 1)?;
        let group_id = uuid_of(group.as_deref(), 1)?;
        let label = clean(string_of(group.as_deref(), 2).as_deref()).map(|l| cut(l, LABEL));
        let mut mine = Vec::new();
        for r in bytes_of(&cue_group, 2) {
            let key = string_of(Some(&fields(r)?), 1).unwrap_or_default();
            let Some(cue) = cues.get(&key) else { continue };
            let Some(text) = slide_text(cue)? else { continue };
            mine.push(parts.len());
            parts.push((label.clone(), cut(text, CONTENT)));
        }
        if let Some(id) = group_id.filter(|id| !id.is_empty()) { if !mine.is_empty() { parts_of_group.insert(id, mine); } }
    }
    if parts.is_empty() { return Ok(None) }
    parts.truncate(PARTS_LIMIT);

    let mut arrangements = Vec::new();
    for b in bytes_of(&p, 11) {
        let arr = fields(b)?;
        let mut indexes = Vec::new();
        for r in bytes_of(&arr, 3) {
            let key = string_of(Some(&fields(r)?), 1).unwrap_or_default();
            indexes.extend(parts_of_group.get(&key).into_iter().flatten().copied().filter(|&i| i < parts.len()));
        }
        if !indexes.is_empty() {
            arrangements.push(json!({ "name": clean(string_of(Some(&arr), 2).as_deref()).map(|n| cut(n, ARRANGEMENT_NAME)), "partIndexes": indexes }));
        }
    }
    arrangements.truncate(ARRANGEMENTS_PER_SONG);
    let block = ccli_block.as_deref();
    Ok(Some(json!({
        "name": cut(name, NAME),
        "author": clean(string_of(block, 1).as_deref()).map(|v| cut(v, AUTHOR)),
        "publisher": clean(string_of(block, 4).as_deref()).map(|v| cut(v, PUBLISHER)),
        "ccli": (ccli_number != 0).then(|| cut(js_number(ccli_number), CCLI)),
        "parts": parts.into_iter().map(|(label, content)| json!({ "labelText": label, "content": content })).collect::<Vec<_>>(),
        "arrangements": arrangements,
    })))
}

/// Standard base64, with or without its padding: the bytes the shell hands over in JSON.
fn base64(s: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c { b'A'..=b'Z' => c - b'A', b'a'..=b'z' => c - b'a' + 26, b'0'..=b'9' => c - b'0' + 52, b'+' => 62, b'/' => 63, _ => return None } as u32)
    };
    let b = s.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(b.len() * 3 / 4);
    for chunk in b.chunks(4) {
        if chunk.len() == 1 { return None }
        let mut n = 0u32;
        for (k, &c) in chunk.iter().enumerate() { n |= value(c)? << (18 - 6 * k) }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 { out.push((n >> 8) as u8) }
        if chunk.len() > 3 { out.push(n as u8) }
    }
    Some(out)
}
