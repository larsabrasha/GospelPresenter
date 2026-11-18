// The export zip's rows (docs/import-from-1x.md; packages/core's legacy.ts at 238d481b, proved against it by
// parity/views/legacy.mjs): an older format's rows brought to this one, the blobs the rows name, the first row the
// server would refuse, and 1.x's overlay as a page. The rows come and go as JSON text, worked on in JavaScript's order
// (ordered.rs), so the pages and lists rewritten here are the text JSON.stringify would write. Rows that are not
// objects, or a table the upgrade reads that is not a list of them, are refused (`invalid-rows`), where 2.0's TS threw
// or made something of them the server then refused.
use crate::args::{is_js_space, js_trim, Obj, R};
use crate::files::cut;
use crate::json::J;
use crate::ordered::{get, given, js_string, parse, set, take, text, value, Fields};
use serde_json::{json, Value};

/// The tables an import writes, parents before the rows that name them (`LEGACY_TABLES`).
const TABLES: [&str; 18] = [
    "labels", "org_settings", "themes", "bibles", "images", "audios", "videos", "overlays", "displays", "songs", "song_parts",
    "song_arrangements", "song_versions", "song_materials", "presentations", "custom_slides", "presentation_items", "ccli_entries",
];

fn refused<T>() -> R<T> { Err("invalid-rows".into()) }
fn rows_arg(a: &Obj) -> R<Fields> {
    match a.get("rows").and_then(Value::as_str).and_then(parse) { Some(J::Obj(f)) => Ok(f), _ => Err("invalid-args".into()) }
}

/// `legacyUpgradeView` {format, rows (JSON text)}: the rows as this format has them, as JSON text.
pub fn upgrade_view(a: &Obj) -> R<Value> {
    let format = a.get("format").and_then(Value::as_f64).ok_or("invalid-args")?;
    Ok(Value::String(J::Obj(upgrade(format, rows_arg(a)?)?).stringify()))
}

/// `legacyBlobsView` {rows (JSON text)}: {named: [hash, row][], videos: hash[]}.
pub fn blobs_view(a: &Obj) -> R<Value> { blobs(&rows_arg(a)?) }

/// `legacyRowsProblemView` {rows (JSON text)}: the first row the server would refuse, named, or null.
pub fn problem_view(a: &Obj) -> R<Value> { Ok(problem(&rows_arg(a)?)?.map_or(Value::Null, Value::String)) }

/// `legacyOverlayPageView` {content, picture}: a 1.x overlay as a page, as JSON text.
pub fn overlay_page_view(a: &Obj) -> R<Value> {
    let picture = a.get("picture").and_then(Value::as_object).map(|p| J::obj(vec![("full", J::of(&p["full"])), ("thumb", J::of(&p["thumb"]))]));
    Ok(Value::String(overlay_page(a.get("content").and_then(Value::as_str), picture).stringify()))
}

/// `exportRowsView` {}: every row of the tables the import writes, with exactly their columns, in their order, by id:
/// what 2.0's export writes into its zip, as JSON text.
pub async fn export_rows() -> R<Value> {
    let mut out = Fields::new();
    for t in TABLES {
        let columns = crate::sync_sql::columns(t).ok_or("unknown-table")?;
        let rows = crate::bridge::sql(&format!("SELECT {} FROM {t} ORDER BY id", columns.join(", ")), vec![]).await;
        let rows = rows.into_iter().map(|r| J::Obj(columns.iter().zip(r.iter()).map(|(c, v)| (c.to_string(), J::of(v))).collect())).collect();
        set(&mut out, t, J::Arr(rows));
    }
    Ok(Value::String(J::Obj(out).stringify()))
}

// ------------------------------------------------------------------ helpers on rows

fn obj_mut(v: &mut J) -> R<&mut Fields> { match v { J::Obj(f) => Ok(f), _ => refused() } }
fn list(rows: &Fields, t: &str) -> R<Vec<Fields>> {
    match get(rows, t) {
        Some(J::Arr(xs)) => xs.iter().map(|x| match x { J::Obj(f) => Ok(f.clone()), _ => refused() }).collect(),
        _ => refused(),
    }
}
fn put(rows: &mut Fields, t: &str, xs: Vec<Fields>) { set(rows, t, J::Arr(xs.into_iter().map(J::Obj).collect())) }
fn with(mut row: Fields, key: &str, v: J) -> Fields { set(&mut row, key, v); row }
fn or_null(v: Option<&J>) -> J { given(v).cloned().unwrap_or(J::Null) }

/// A row's page JSON, or pages JSON, through `f`; one that does not read is left as it was.
fn rewrite(json: Option<&J>, f: impl Fn(J) -> J) -> J {
    match parse(text(json).unwrap_or("")) { Some(v) => J::Str(f(v).stringify()), None => json.cloned().unwrap_or(J::Null) }
}

type Pictures = Vec<(String, J)>;
fn picture_of(images: &Pictures, id: Option<&J>) -> Option<J> {
    let key = js_string(id);
    images.iter().rev().find(|(k, _)| *k == key).map(|(_, p)| p.clone())
}

/// A page of a zip before format 5 as this format has it: a picture of Bilder named by id (`imageId`,
/// `backgroundImageId`) becomes the page's own blobs, those of the zip's picture; one the zip lacks is left out.
fn own_pictures(page: J, images: &Pictures) -> J {
    let mut rest = match page {
        J::Obj(f) => f,
        J::Arr(xs) => xs.into_iter().enumerate().map(|(i, x)| (i.to_string(), x)).collect(),
        other => return other,
    };
    let background = take(&mut rest, "backgroundImageId");
    let elements = take(&mut rest, "elements");
    if let Some(id) = background { set(&mut rest, "backgroundPicture", picture_of(images, Some(&id)).unwrap_or(J::Null)) }
    let page = or_null(get(&rest, "backgroundPage"));
    set(&mut rest, "backgroundPage", page);
    match elements {
        Some(J::Arr(xs)) => {
            let own = xs.into_iter().flat_map(|e| match e {
                J::Obj(mut f) if matches!(get(&f, "kind"), Some(J::Str(k)) if k == "image") && get(&f, "imageId").is_some() => {
                    let id = take(&mut f, "imageId");
                    picture_of(images, id.as_ref()).map(|p| J::Obj(with(f, "picture", p)))
                }
                e => Some(e),
            });
            set(&mut rest, "elements", J::Arr(own.collect()));
        }
        Some(other) => set(&mut rest, "elements", other),
        None => {}
    }
    J::Obj(rest)
}

/// A slideshow row of a PDF's pages (`slideDeckPagesSchema`, then `pdfPages`), as schema 21 made them; None where the
/// pages do not read.
fn slideshow_row(id: Option<&J>, name: Option<&J>, pages: &J) -> Option<Fields> {
    let pages = crate::pages::pdf_pages(Some(&value(pages)), &mut Vec::new()).ok()?;
    Some(vec![
        ("id".into(), or_null(id)), ("name".into(), or_null(name)), ("pages".into(), J::Str(pages.stringify())),
        ("created_at".into(), J::Num(0.0)), ("updated_at".into(), J::Num(0.0)), ("deleted_at".into(), J::Null),
    ])
}

// ------------------------------------------------------------------ the upgrade

/// A zip's rows as this format has them (`upgradeLegacyRows`): before 4 a deck's pages become a slideshow of PDF pages
/// that its item names; before 5 a page's pictures of Bilder become its own; before 6 an item has no comment; before 7
/// no picture is edited; in every format a song part that is only an RTF leftover goes; and the fields that keep a
/// time each take the row's last change.
fn upgrade(format: f64, rows: Fields) -> R<Fields> { with_field_times(without_rtf_leftovers(upgrade_format(format, rows)?)?) }

fn upgrade_format(format: f64, mut rows: Fields) -> R<Fields> {
    let mut default = |t: &str| take(&mut rows, t).unwrap_or(J::Arr(vec![]));
    let (decks, slideshows) = (default("slide_decks"), default("custom_slides"));
    let (themes, videos, materials) = (default("themes"), default("videos"), default("song_materials"));
    let mut rest = rows;
    for (t, v) in [("themes", themes), ("videos", videos), ("song_materials", materials)] { set(&mut rest, t, v) }
    if format < 6.0 {
        let items = list(&rest, "presentation_items")?.into_iter().map(|i| with(i, "note", J::Null)).collect();
        put(&mut rest, "presentation_items", items);
    }
    if format < 7.0 {
        let unedited = |i: Fields| ["original_full_hash", "original_thumb_hash", "original_width", "original_height", "edit"].into_iter().fold(i, |i, k| with(i, k, J::Null));
        let images = list(&rest, "images")?.into_iter().map(unedited).collect();
        put(&mut rest, "images", images);
    }
    if format >= 5.0 { set(&mut rest, "custom_slides", slideshows); return Ok(rest) }

    let images: Pictures = list(&rest, "images")?.iter().map(|i| {
        let p = J::obj(vec![("full", J::Str(js_string(get(i, "full_hash")))), ("thumb", J::Str(js_string(get(i, "thumb_hash"))))]);
        (js_string(get(i, "id")), p)
    }).collect();
    let own = |v: J| own_pictures(v, &images);
    if format == 4.0 {
        let overlays = list(&rest, "overlays")?.into_iter().map(|o| { let c = rewrite(get(&o, "content"), own); with(o, "content", c) }).collect();
        put(&mut rest, "overlays", overlays);
        let J::Arr(shows) = slideshows else { return refused() };
        let shows = shows.into_iter().map(|r| {
            let mut r = r;
            let pages = rewrite(get(obj_mut(&mut r)?, "pages"), |v| match v { J::Arr(ps) => J::Arr(ps.into_iter().map(own).collect()), v => v });
            set(obj_mut(&mut r)?, "pages", pages);
            Ok(r)
        }).collect::<R<Vec<_>>>()?;
        set(&mut rest, "custom_slides", J::Arr(shows));
        return Ok(rest);
    }

    let mut made: Vec<Fields> = Vec::new();
    let J::Arr(decks) = decks else { return refused() };
    for d in decks {
        let J::Obj(d) = d else { return refused() };
        let pages = parse(text(get(&d, "pages")).unwrap_or(""));
        match pages.and_then(|p| slideshow_row(get(&d, "id"), get(&d, "name"), &p)) {
            Some(row) => made.push(row),
            None => made.push(with(d, "pages", J::Null)), // left for the problem check to name
        }
    }
    let items = list(&rest, "presentation_items")?.into_iter().map(|item| {
        if !matches!(get(&item, "type"), Some(J::Str(t)) if t == "slides") { return item }
        if format >= 3.0 { return with(item, "type", J::str("custom")) }
        let pages = parse(text(get(&item, "content")).unwrap_or("")).and_then(|c| match c { J::Obj(f) => get(&f, "pages").cloned(), _ => None });
        match pages.and_then(|p| slideshow_row(get(&item, "id"), get(&item, "title"), &p)) {
            Some(row) => {
                made.push(row);
                let source = or_null(get(&item, "id"));
                with(with(with(item, "type", J::str("custom")), "source_id", source), "content", J::Null)
            }
            None => item, // left for the problem check to name
        }
    }).collect();
    let overlays = list(&rest, "overlays")?.into_iter().map(|o| {
        if format == 1.0 {
            let page = overlay_page(text(get(&o, "content")), picture_of(&images, get(&o, "image_id")));
            vec![
                ("id".into(), or_null(get(&o, "id"))), ("title".into(), or_null(get(&o, "title"))), ("content".into(), J::Str(page.stringify())),
                ("image_id".into(), J::Null), ("sort".into(), or_null(get(&o, "sort"))), ("updated_at".into(), J::Null),
            ]
        } else {
            let c = rewrite(get(&o, "content"), own);
            with(o, "content", c)
        }
    }).collect();
    put(&mut rest, "overlays", overlays);
    put(&mut rest, "presentation_items", items);
    put(&mut rest, "custom_slides", made);
    Ok(rest)
}

/// A song part 1.x left with only what its ProPresenter import kept of an empty slide's RTF header (`;;`, `\*;;`).
fn rtf_leftover(content: Option<&J>) -> bool {
    matches!(content, Some(J::Str(s)) if s.contains(';') && s.chars().all(|c| is_js_space(c) || matches!(c, ';' | '\\' | '*')))
}

/// The rows without the song parts that are RTF leftovers, and the arrangements without their ids.
fn without_rtf_leftovers(mut rows: Fields) -> R<Fields> {
    let parts = list(&rows, "song_parts")?;
    // The ids gone, as a Set holds them: a missing id is `undefined`, equal to another missing one; an object only to
    // itself, so the part it is in goes by its place.
    let gone: Vec<(usize, Option<J>)> = parts.iter().enumerate().filter(|(_, p)| rtf_leftover(get(p, "content"))).map(|(i, p)| (i, get(p, "id").cloned())).collect();
    if gone.is_empty() { return Ok(rows) }
    let has = |id: Option<&J>| gone.iter().any(|(_, g)| match (g, id) { (None, None) => true, (Some(a), Some(b)) => a == b, _ => false });
    let kept = parts.into_iter().enumerate().filter(|(i, p)| !gone.iter().any(|(g, _)| g == i) && !has(get(p, "id"))).map(|(_, p)| p).collect();
    put(&mut rows, "song_parts", kept);
    let arrangements = list(&rows, "song_arrangements")?.into_iter().map(|a| {
        let ids = rewrite(get(&a, "part_ids"), |v| match v { J::Arr(ids) => J::Arr(ids.into_iter().filter(|id| !has(Some(id))).collect()), v => v });
        with(a, "part_ids", ids)
    }).collect();
    put(&mut rows, "song_arrangements", arrangements);
    Ok(rows)
}

/// The fields that keep a time each (schema 27, SYNC-R23) take it from the row's last change where they have none.
fn with_field_times(mut rows: Fields) -> R<Fields> {
    for (t, fields) in [("custom_slides", &["name", "pages"][..]), ("overlays", &["title", "content"][..]), ("themes", &["name", "definition"][..])] {
        let timed = list(&rows, t)?.into_iter().map(|r| fields.iter().fold(r, |r, f| {
            let key = format!("{f}_at");
            let at = given(get(&r, &key)).or_else(|| given(get(&r, "updated_at"))).cloned().unwrap_or(J::Null);
            with(r, &key, at)
        })).collect();
        put(&mut rows, t, timed);
    }
    Ok(rows)
}

// ------------------------------------------------------------------ the blobs and the check

fn unique(xs: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in xs { if !out.contains(&x) { out.push(x) } }
    out
}

/// JSON text as JSON.parse reads it, as the schemas check it; None where it does not read.
fn read(json: Option<&str>) -> Option<Value> { parse(json.unwrap_or("")).map(|j| value(&j)) }

/// The blobs of a slideshow's pages or an overlay's page that read (`customPageBlobs`); none of one that does not.
fn page_blobs(json: Option<&J>, many: bool) -> Vec<String> {
    let Some(v) = read(text(json)) else { return vec![] };
    let mut blobs = Vec::new();
    let ok = if many { crate::pages::pages(Some(&v), &mut blobs).is_ok() } else { crate::pages::page(&v, &mut blobs).is_ok() };
    if ok { unique(blobs) } else { vec![] }
}

/// The blobs the rows name, each with the row that names it ("images {id}"), and which of them are videos.
fn blobs(rows: &Fields) -> R<Value> {
    let mut named: Vec<(String, String)> = Vec::new();
    let mut add = |row: String, hashes: Vec<Option<&J>>| {
        for h in hashes { if let Some(J::Str(h)) = h { if !h.is_empty() { named.push((h.clone(), row.clone())) } } }
    };
    let label = |t: &str, r: &Fields| format!("{t} {}", js_string(get(r, "id")));
    for i in list(rows, "images")? { add(label("images", &i), ["full_hash", "thumb_hash", "original_full_hash", "original_thumb_hash"].map(|k| get(&i, k)).to_vec()) }
    for a in list(rows, "audios")? { add(label("audios", &a), vec![get(&a, "hash")]) }
    let videos = list(rows, "videos")?;
    for v in &videos { add(label("videos", v), vec![get(v, "hash"), get(v, "still_hash"), get(v, "thumb_hash")]) }
    for m in list(rows, "song_materials")? { add(label("song_materials", &m), vec![get(&m, "hash")]) }
    for c in list(rows, "custom_slides")? {
        let hs: Vec<J> = page_blobs(get(&c, "pages"), true).into_iter().map(J::Str).collect();
        add(label("custom_slides", &c), hs.iter().map(Some).collect());
    }
    for o in list(rows, "overlays")? {
        let hs: Vec<J> = page_blobs(get(&o, "content"), false).into_iter().map(J::Str).collect();
        add(label("overlays", &o), hs.iter().map(Some).collect());
    }
    for th in list(rows, "themes")? {
        let definition = read(text(get(&th, "definition")));
        if let Some((_, hs)) = definition.and_then(|d| crate::theme_def::definition(Some(&d)).ok()) {
            let hs: Vec<J> = hs.into_iter().map(J::Str).collect();
            add(label("themes", &th), hs.iter().map(Some).collect());
        }
    }
    let videos = unique(videos.iter().map(|v| js_string(get(v, "hash"))).collect());
    Ok(json!({ "named": named.into_iter().map(|(h, r)| json!([h, r])).collect::<Vec<_>>(), "videos": videos }))
}

/// A Bible item's content that reads (`bibleItemContentSchema`): a translation of at most 50, and slides of segments.
fn bible_content(json: Option<&str>) -> bool {
    let Some(Value::Object(o)) = json.filter(|j| !j.is_empty()).and_then(|j| read(Some(j))) else { return false };
    let units = |s: &str| s.encode_utf16().count();
    let segment = |s: &Value| s.as_object().is_some_and(|s| {
        let n = match s.get("n") { Some(Value::Null) => true, Some(n) => n.as_f64().is_some_and(|n| n.fract() == 0.0 && (0.0..=999.0).contains(&n)), None => false };
        n && s.get("t").and_then(Value::as_str).is_some_and(|t| units(t) <= 10_000)
    });
    o.get("translation").and_then(Value::as_str).is_some_and(|t| units(t) <= 50)
        && o.get("slides").and_then(Value::as_array).is_some_and(|ss| ss.len() <= 1000 && ss.iter().all(|s| s.as_array().is_some_and(|s| s.len() <= 500 && s.iter().all(segment))))
}

/// The first row the server would refuse, named by its table and id (`legacyRowsProblem`): its columns must be exactly
/// the table's, with an id; an output's kind public or screen; a slideshow's pages that read; no slide deck item and
/// no Bible passage that does not read.
fn problem(rows: &Fields) -> R<Option<String>> {
    for t in TABLES {
        let columns = crate::sync_sql::columns(t).unwrap_or(&[]);
        for r in list(rows, t)? {
            let missing = columns.iter().filter(|c| get(&r, c).is_none()).map(|c| format!("no {c}"));
            let extra = r.iter().filter(|(k, _)| !columns.contains(&k.as_str())).map(|(k, _)| format!("unknown {k}"));
            let mismatch: Vec<String> = missing.chain(extra).collect();
            let why = if !mismatch.is_empty() { Some(mismatch.join(", ")) } else if !matches!(get(&r, "id"), Some(J::Str(id)) if !id.is_empty()) { Some("no id".into()) } else { None };
            if let Some(why) = why { return Ok(Some(format!("{t} {}: {why}", js_string(get(&r, "id"))))) }
        }
    }
    for d in list(rows, "displays")? {
        if !matches!(get(&d, "kind"), Some(J::Str(k)) if k == "public" || k == "screen") {
            return Ok(Some(format!("displays {}: no kind \"{}\"", js_string(get(&d, "id")), js_string(get(&d, "kind")))));
        }
    }
    for c in list(rows, "custom_slides")? {
        let reads = read(text(get(&c, "pages"))).is_some_and(|v| crate::pages::pages(Some(&v), &mut Vec::new()).is_ok());
        if !reads { return Ok(Some(format!("custom_slides {}: pages that do not read", js_string(get(&c, "id"))))) }
    }
    for item in list(rows, "presentation_items")? {
        let kind = text(get(&item, "type"));
        if kind == Some("slides") { return Ok(Some(format!("presentation_items {}: a slide deck item, not a slideshow", js_string(get(&item, "id"))))) }
        if kind == Some("bible") && !bible_content(text(get(&item, "content"))) {
            return Ok(Some(format!("presentation_items {}: a Bible passage that does not read", js_string(get(&item, "id")))));
        }
    }
    Ok(None)
}

// ------------------------------------------------------------------ 1.x's overlay

/// A 1.x overlay as a page (`legacyOverlayPage`), drawn as 1.x drew it: its picture over the whole stage, fitted, and
/// its text above it at the top left, white.
fn overlay_page(content: Option<&str>, picture: Option<J>) -> J {
    let text = content.map(|c| cut(js_trim(c).to_string(), crate::pages::TEXT)).unwrap_or_default();
    let mut elements = Vec::new();
    if let Some(p) = picture {
        elements.push(J::obj(vec![("id", J::str("image")), ("kind", J::str("image")), ("x", J::Num(0.0)), ("y", J::Num(0.0)), ("w", J::Num(1920.0)),
            ("h", J::Num(1080.0)), ("picture", p), ("fit", J::str("contain"))]));
    }
    if !text.is_empty() {
        let h = (1080.0 - 64.0f64).min(text.split('\n').count() as f64 * 60.0);
        elements.push(J::obj(vec![("id", J::str("text")), ("kind", J::str("text")), ("x", J::Num(80.0)), ("y", J::Num(32.0)), ("w", J::Num(1760.0)),
            ("h", J::Num(h)), ("text", J::Str(text)), ("size", J::Num(40.0)), ("bold", J::Bool(false)), ("italic", J::Bool(false)),
            ("align", J::str("left")), ("color", J::str("#ffffff"))]));
    }
    J::obj(vec![("background", J::Null), ("backgroundPicture", J::Null), ("backgroundPage", J::Null), ("elements", J::Arr(elements))])
}
