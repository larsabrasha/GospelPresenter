// What a device does with its media files (docs/media-and-files.md, "Media"; Lars, 2026-11-20): the web's
// syncMedia, MediaUploads and storageReport (packages/sync/src/client/media.ts at bb87c4aa) worked out in the core, so
// every shell fetches, keeps, drops and uploads alike. The shell moves the bytes and checks each file's hash; the core
// says which files. A shell that keeps its files in `media_blobs` (the web) lets the core read them; one that keeps
// them elsewhere (the Mac and iOS app's folder) says what it holds (`held`).
use crate::args::*;
use crate::bridge::sql;
use crate::media_wanted::{column, kept, overlay_pictures, policy, presentation_files, slideshow_pictures, theme_pictures, wanted};
use crate::mutators::{int_of, s};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

/// How long a blob nothing names is kept (`ORPHAN_GRACE_MS`), so one uploaded just before its add is pushed survives.
const ORPHAN_GRACE_MS: i64 = 60 * 60 * 1000;
/// The most bytes kept of files nothing wants now, where the shell names none (`DEFAULT_MEDIA_POLICY.budget`).
const DEFAULT_BUDGET: i64 = 2 * 1024 * 1024 * 1024;

const DECK_PAGES: [&str; 5] = ["addSlides", "createCustomSlide", "updateCustomSlide", "createOverlay", "updateOverlay"];
const THEMES: [&str; 2] = ["createTheme", "updateTheme"];
/// The mutators that name blobs a device kept first (`BLOB_ADDS`).
fn names_blobs(m: &str) -> bool {
    ["addImage", "editImage", "addAudio", "addVideo", "addSongFile"].contains(&m) || DECK_PAGES.contains(&m) || THEMES.contains(&m)
}

/// `MEDIA_HASH`: a SHA-256 as 64 lowercase hex digits.
fn is_hash(h: &str) -> bool { h.len() == 64 && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }

/// JavaScript's `String(v)` of a field that may be missing, as the web named a blob ("undefined" when it is).
pub(crate) fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(t)) => t.clone(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => i.to_string(),
            // A whole number held as a float is written without its ".0", as JavaScript writes it.
            (None, Some(f)) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
            _ => n.to_string(),
        },
        Some(Value::Array(xs)) => xs.iter().map(|x| if x.is_null() { String::new() } else { js_string(Some(x)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

fn ordered(xs: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    xs.into_iter().filter(|x| seen.insert(x.clone())).collect()
}

/// `customPageBlobs`: every picture the pages draw, both sizes; none when a page does not read as one.
fn page_blobs(pages: &[Value]) -> Vec<String> {
    let mut out = vec![];
    for p in pages {
        let Some(elements) = p.get("elements").and_then(Value::as_array) else { return vec![] };
        let mut pictures: Vec<&Value> = ["backgroundPicture", "backgroundPage"].iter().filter_map(|k| p.get(*k).filter(|v| truthy(v))).collect();
        for e in elements.iter().filter(|e| e.get("kind").and_then(Value::as_str) == Some("image")) {
            match e.get("picture") {
                Some(pic) if pic.is_object() => pictures.push(pic),
                _ => return vec![], // the web's `e.picture.full` threw on it
            }
        }
        for pic in pictures { out.extend([js_string(pic.get("full")), js_string(pic.get("thumb"))]) }
    }
    ordered(out)
}

fn truthy(v: &Value) -> bool {
    !matches!(v, Value::Null | Value::Bool(false)) && v.as_str() != Some("") && v.as_f64() != Some(0.0)
}

/// `themeBlobs` of a definition that reads: each picture background's two blobs.
fn theme_blobs(d: &Value) -> Vec<String> {
    let grounds = [d.pointer("/song/background"), d.pointer("/bible/background"), d.get("media")];
    if grounds.iter().any(|g| !g.is_some_and(Value::is_object)) { return vec![] }
    grounds.into_iter().flatten()
        .filter_map(|g| g.get("image").filter(|i| i.get("kind").and_then(Value::as_str) == Some("picture")))
        .flat_map(|i| [js_string(i.get("full")), js_string(i.get("thumb"))])
        .collect()
}

/// `blobsOf`: the blobs a queued change names, in order.
pub(crate) fn blobs_of(name: &str, args: &Value) -> Vec<String> {
    let f = |k: &str| js_string(args.get(k));
    let blobs = if THEMES.contains(&name) {
        args.get("definition").map(theme_blobs).unwrap_or_default()
    } else if name == "addAudio" || name == "addSongFile" {
        vec![f("hash")]
    } else if name == "addVideo" {
        vec![f("hash"), f("stillHash"), f("thumbHash")]
    } else if name == "addSlides" {
        let pages = args.get("pages").and_then(Value::as_array).cloned().unwrap_or_default();
        pages.iter().flat_map(|p| [js_string(p.get("full")), js_string(p.get("thumb"))]).collect()
    } else if DECK_PAGES.contains(&name) {
        let pages: Vec<Value> = if name.ends_with("Overlay") {
            args.get("page").filter(|p| truthy(p)).into_iter().cloned().collect()
        } else {
            args.get("pages").and_then(Value::as_array).cloned().unwrap_or_default()
        };
        page_blobs(&pages)
    } else {
        vec![f("fullHash"), f("thumbHash")]
    };
    ordered(blobs)
}

/// The queue, each change that names blobs with its place in it and the blobs.
async fn queued() -> Vec<(usize, Vec<String>)> {
    let rows = sql("SELECT name, args FROM _mutation ORDER BY id", vec![]).await;
    rows.iter().enumerate()
        .filter(|(_, r)| names_blobs(&s(&r[0])))
        .map(|(i, r)| (i, blobs_of(&s(&r[0]), &serde_json::from_str(&s(&r[1])).unwrap_or(Value::Null))))
        .collect()
}

/// The blobs this device holds with their bytes, oldest first: {hash, size, at}, as the shell says or as
/// `media_blobs` keeps them.
async fn held(a: &Obj) -> Vec<(String, i64, i64)> {
    if let Some(list) = a.get("held").and_then(Value::as_array) {
        let mut h: Vec<(String, i64, i64)> = list.iter().map(|f| (js_string(f.get("hash")), f.get("size").map_or(0, int_of), f.get("at").map_or(0, int_of))).collect();
        h.sort_by(|x, y| x.2.cmp(&y.2).then_with(|| x.0.cmp(&y.0)));
        return h;
    }
    sql("SELECT hash, size, received_at FROM media_blobs WHERE bytes IS NOT NULL ORDER BY received_at, hash", vec![]).await
        .into_iter().map(|r| (s(&r[0]), int_of(&r[1]), int_of(&r[2]))).collect()
}

/// Each list of blobs something of the organisation names (what `ORPHAN_BLOBS_SQL` keeps): sheet music and recordings,
/// pictures (their originals too), audio, videos (their files, stills and thumbnails), and the pictures of
/// slideshows, overlays and own themes.
fn named_lists() -> Vec<String> {
    let mut lists: Vec<String> = [
        "SELECT hash FROM song_materials WHERE hash IS NOT NULL",
        "SELECT full_hash FROM images",
        "SELECT thumb_hash FROM images",
        "SELECT original_full_hash FROM images WHERE original_full_hash IS NOT NULL",
        "SELECT original_thumb_hash FROM images WHERE original_thumb_hash IS NOT NULL",
        "SELECT hash FROM audios",
        "SELECT hash FROM videos",
        "SELECT still_hash FROM videos",
        "SELECT thumb_hash FROM videos",
    ].map(String::from).into();
    for pictures in [slideshow_pictures(), overlay_pictures(), theme_pictures()] {
        lists.extend([format!("SELECT full_hash FROM ({pictures})"), format!("SELECT thumb_hash FROM ({pictures})")]);
    }
    lists
}

/// The blobs nothing names, older than the grace: from `media_blobs` as `ORPHAN_BLOBS_SQL` finds them (a row there
/// without bytes too, a video's), or among those the shell holds.
async fn orphans(a: &Obj, held: &[(String, i64, i64)], before: i64) -> Vec<String> {
    if a.get("held").is_some() {
        let named: HashSet<String> = column(&named_lists().join(" UNION "), vec![]).await.into_iter().collect();
        return held.iter().filter(|(h, _, at)| *at < before && !named.contains(h)).map(|(h, _, _)| h.clone()).collect();
    }
    // As the web's query reads it, `NOT IN` each list apart (a list holding a null keeps every blob).
    let not_in: Vec<String> = named_lists().iter().map(|l| format!("AND hash NOT IN ({l})")).collect();
    column(&format!("SELECT hash FROM media_blobs WHERE received_at < ? {}", not_in.join(" ")), vec![json!(before)]).await
}

/// `mediaPlanView` {presenting, persistent, keepComing, today, days, fetch, budget, now, held?}: what to fetch (what is
/// wanted and not held, in the order to fetch it), what to drop (what nothing names past the grace, never what a
/// queued change names; then, while the files nothing wants now are over `budget`, the oldest of those), and the
/// bytes of that cache after the drop (`syncMedia`). `held`: [{hash, size, at}] the shell keeps, where not in
/// `media_blobs`; `inUse`: the hashes its player has (a video playing, the next item's fetched in advance).
pub async fn plan_view(a: &Obj) -> R<Value> {
    let p = policy(a)?;
    // Without one, the web's (MEDIA-R14: 2 GiB), never 0: a shell that left it out would lose its whole cache.
    let budget = a.get("budget").map_or(DEFAULT_BUDGET, int_of);
    let now = a.get("now").map_or(0, int_of);
    let (wanted, _) = wanted(&p).await;
    let held = held(a).await;
    let have: HashSet<&str> = held.iter().map(|(h, _, _)| h.as_str()).collect();
    let fetch: Vec<&String> = wanted.iter().filter(|h| !have.contains(h.as_str())).collect();
    let mut queued: HashSet<String> = queued().await.into_iter().flat_map(|(_, b)| b).collect();
    // What the shell's player has, or fetched in advance, is kept as what waits to be uploaded is: never dropped, never
    // cache.
    queued.extend(a.get("inUse").and_then(Value::as_array).into_iter().flatten().map(|h| js_string(Some(h))));
    // A shell that keeps videos in its folder keeps the presented presentation's while it is presented, so going back
    // to one played earlier never waits for it again (the web streams its videos, kept apart in `video_files`).
    if let (Some(_), Some(id)) = (a.get("held"), &p.presenting) {
        queued.extend(column("SELECT v.hash FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'video'", vec![json!(id)]).await);
    }
    let mut drop: Vec<String> = orphans(a, &held, now - ORPHAN_GRACE_MS).await.into_iter().filter(|h| !queued.contains(h)).collect();
    let keep: HashSet<&String> = wanted.iter().chain(queued.iter()).chain(drop.iter()).collect();
    let spare: Vec<&(String, i64, i64)> = held.iter().filter(|(h, _, _)| !keep.contains(h)).collect();
    let mut cache: i64 = spare.iter().map(|(_, size, _)| size).sum();
    let mut evicted = vec![];
    for (h, size, _) in spare {
        if cache <= budget { break }
        evicted.push(h.clone());
        cache -= size;
    }
    drop.extend(evicted);
    Ok(json!({ "fetch": fetch, "drop": drop, "cache": cache }))
}

/// `mediaUploadsView` {uploaded: {hash: at}, now}: the blobs to upload before a push, in order, each with the place
/// in the queue of the change that names it (`MediaUploads.beforePush`): a valid hash, held with its bytes, not
/// uploaded in the last half of the grace (an upload starts the server's grace over). An upload that cannot reach the
/// server holds back that change and all after it: the push's limit is its place.
pub async fn uploads_view(a: &Obj) -> R<Value> {
    let uploaded = a.get("uploaded").and_then(Value::as_object).cloned().unwrap_or_default();
    let now = a.get("now").map_or(0, int_of);
    let with_bytes: HashSet<String> = column("SELECT hash FROM media_blobs WHERE bytes IS NOT NULL", vec![]).await.into_iter().collect();
    // A blob two changes name is listed at each: the shell sends it once a push.
    let mut out = vec![];
    for (index, blobs) in queued().await {
        for hash in blobs {
            let recent = uploaded.get(&hash).is_some_and(|at| now - int_of(at) < ORPHAN_GRACE_MS / 2);
            if !is_hash(&hash) || recent || !with_bytes.contains(&hash) { continue }
            out.push(json!({ "index": index, "hash": hash }));
        }
    }
    Ok(json!({ "uploads": out }))
}

/// `mediaStorageView` {presenting, persistent, keepComing, today, days, fetch, held?}: how this device's files are used
/// (`storageReport`): every file kept, each presentation kept offline with the bytes of the files it needs, those
/// files once, and the cache (what is neither wanted, nor waiting to be uploaded, nor a video kept offline). `held`:
/// [{hash, size, at}] a shell keeping its files in a folder holds, videos too, in place of `media_blobs` and
/// `video_files`.
pub async fn storage_view(a: &Obj) -> R<Value> {
    let p = policy(a)?;
    let mut sizes: Map<String, Value> = Map::new();
    // A list, as held() reads it; a held of null is the web's (no folder), not an empty folder.
    if a.get("held").and_then(Value::as_array).is_some() {
        for (hash, size, _) in held(a).await { sizes.insert(hash, json!(size)); }
    } else {
        for r in sql("SELECT hash, size FROM media_blobs WHERE bytes IS NOT NULL", vec![]).await { sizes.insert(s(&r[0]), json!(int_of(&r[1]))); }
        for r in sql("SELECT hash, received FROM video_files", vec![]).await { sizes.insert(s(&r[0]), json!(int_of(&r[1]))); }
    }
    let sum = |hashes: &mut dyn Iterator<Item = &String>| -> i64 {
        let mut seen = HashSet::new();
        hashes.filter(|h| seen.insert((*h).clone())).map(|h| sizes.get(h).map_or(0, int_of)).sum()
    };
    let (blobs, videos) = wanted(&p).await;
    let mut wanted_all: HashSet<String> = blobs.into_iter().collect();
    wanted_all.extend(queued().await.into_iter().flat_map(|(_, b)| b));
    wanted_all.extend(videos.iter().map(|v| js_string(v.get("hash"))));
    let mut shared = column(&format!("SELECT o.full_hash AS hash FROM ({}) o", overlay_pictures()), vec![]).await;
    shared.extend(column(&format!("SELECT full_hash AS hash FROM ({})", theme_pictures()), vec![]).await);
    let mut offline = vec![];
    let mut kept_files: Vec<String> = vec![];
    for id in kept(&p).await {
        let own = column("SELECT v.hash FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.presentation_id = ? AND p.type = 'video'", vec![json!(id)]).await;
        let files: Vec<String> = shared.iter().cloned().chain(presentation_files(&id).await).chain(own).collect();
        offline.push(json!({ "presentationId": id, "bytes": sum(&mut files.iter()) }));
        kept_files.extend(files);
    }
    let keys: Vec<String> = sizes.keys().cloned().collect();
    let cache: Vec<String> = keys.iter().filter(|h| !wanted_all.contains(*h)).cloned().collect();
    Ok(json!({ "total": sum(&mut keys.iter()), "offline": offline, "offlineTotal": sum(&mut kept_files.iter()), "cache": sum(&mut cache.iter()) }))
}

#[cfg(test)]
#[path = "media_plan_tests.rs"]
mod tests;
