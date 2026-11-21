// What some of Inställningar's pages hold and offer, worked out once for every shell (docs/view-models.md): the trash
// (the web's Trash.tsx), which kinds a role sees in it, their order, the days each has left and which mutators restore
// and purge it. The words are the shells' (i18n.ts's keys by the kind: `trash.kind.{kind}`, `trash.one.{kind}`).
use crate::args::*;
use crate::mutators::can;
use serde_json::{json, Value};

/// The trash's kinds in the web's order (router.ts `TRASH_KINDS`), each with the permission that manages it and the
/// mutators that restore and purge one.
const KINDS: [(&str, &str, &str, &str); 7] = [
    ("Presentation", "ManagePresentations", "restorePresentation", "purgePresentation"),
    ("Template", "ManageTemplates", "restoreTemplate", "purgeTemplate"),
    ("Song", "ManageSongs", "restoreSong", "purgeSong"),
    ("Image", "ManageImages", "restoreImage", "purgeImage"),
    ("Audio", "ManageAudios", "restoreAudio", "purgeAudio"),
    ("Video", "ManageVideos", "restoreVideo", "purgeVideo"),
    ("Slide", "ManagePresentations", "restoreCustomSlide", "purgeCustomSlide"),
];

/// `ccliPageView` {locale, filter, keep}: the CCLI report as the page shows it (the web's CcliReport.tsx and
/// ccliReport.ts): whether collection is `on`, and the entries `filter` (all, unreported, reported) matches, or `keep`
/// names (those switched while the page was open stay until the filter changes), as `cards`, one per day and
/// presentation in the entries' order (02 Q13, 2026-10-31), each its `key`, `date`, `presentationName` (empty for
/// a song shown outside a presentation: the shell says "Övrigt"), its `entries`, and whether every one is `reported`.
pub async fn ccli_page(a: &Obj) -> R<Value> {
    let report = crate::settings_views::ccli_report(a).await?;
    let filter = a.get("filter").and_then(Value::as_str).unwrap_or("all");
    let keep: Vec<&str> = a.get("keep").and_then(Value::as_array).map(|k| k.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let matches = |e: &Value| filter == "all" || (filter == "reported") == !e["reportedAt"].is_null() || keep.contains(&e["id"].as_str().unwrap_or(""));
    let mut cards: Vec<Value> = Vec::new();
    for e in report["entries"].as_array().unwrap().iter().filter(|e| matches(e)) {
        let key = format!("{}|{}", e["date"].as_str().unwrap_or(""), e["presentationId"].as_str().unwrap_or(""));
        match cards.iter_mut().find(|c| c["key"] == key.as_str()) {
            Some(c) => c["entries"].as_array_mut().unwrap().push(e.clone()),
            None => cards.push(json!({ "key": key, "date": e["date"], "presentationName": e["presentationName"], "entries": [e] })),
        }
    }
    for c in &mut cards { c["reported"] = json!(c["entries"].as_array().unwrap().iter().all(|e| !e["reportedAt"].is_null())) }
    Ok(json!({ "on": report["on"], "cards": cards }))
}

/// `freshNameView` {base, taken}: `base`, or `base 2`, `base 3` … the first that no name in `taken` is, any case, as
/// Finder names a new folder (the web's `freshName`): what + names a new song, slideshow, overlay or theme.
pub fn fresh_name(a: &Obj) -> R<Value> {
    let base = a.get("base").and_then(Value::as_str).ok_or("invalid-args")?;
    let taken: std::collections::HashSet<String> = a.get("taken").and_then(Value::as_array).map(|t| t.iter().filter_map(Value::as_str).map(|n| n.trim().to_lowercase()).collect()).unwrap_or_default();
    if !taken.contains(&base.to_lowercase()) { return Ok(json!(base)) }
    Ok(json!((2..).map(|n| format!("{base} {n}")).find(|n| !taken.contains(&n.to_lowercase())).unwrap()))
}

/// `displayCodeView` {random}: a new output code (LIVE-R30) from the shell's cryptographic random bytes, as
/// packages/core's `displayCode`: seven of the letters and digits not easily confused, unbiased by rejection. Null when
/// the bytes ran out first (a shell gives 64, which never do in practice).
pub fn display_code(a: &Obj) -> R<Value> {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let limit = 256 - (256 % ALPHABET.len() as u32);
    let bytes = a.get("random").and_then(Value::as_array).ok_or("invalid-args")?;
    let code: String = bytes.iter().filter_map(Value::as_u64).filter(|b| (*b as u32) < limit).take(7).map(|b| ALPHABET[b as usize % ALPHABET.len()] as char).collect();
    Ok(if code.len() == 7 { json!(code) } else { Value::Null })
}

/// A picture fitted within a box, aspect kept and never upscaled, rounded (packages/core's `fitWithin`, MEDIA-R4).
fn fit_within(w: f64, h: f64, max_w: f64, max_h: f64) -> Value {
    let scale = 1f64.min(max_w / w).min(max_h / h);
    json!({ "width": (w * scale).round().max(1.0) as i64, "height": (h * scale).round().max(1.0) as i64 })
}

/// `mediaImportView` {kind, name, size, type?, width?, height?, head?}: what an import of a file does with it, as the web's
/// media/process.ts and imports.ts decide (MEDIA-R1, R2, R4, R5, R13), so every shell takes and refuses the same files.
/// `refused`: why not (`type`, `size`, `name`), else null. A picture (`kind` image, its decoded `width` and `height`):
/// the type it is stored as (JPEG stays JPEG, the rest WebP; a shell that cannot write WebP stores JPEG, as the web
/// does where the browser cannot) and its two sizes, `full` within 1920×1080 at quality 0.9 and `thumb` within 400×225
/// at 0.8. A sound (`kind` audio): taken by the type the platform reports or, with none, its extension; its bytes kept
/// as they are, under the type its first bytes say (`head`, at least 12 of them), bytes that are no sound refused.
/// Checked type, then size, then name, in the web's order.
pub fn media_import(a: &Obj) -> R<Value> {
    let kind = a.get("kind").and_then(Value::as_str).ok_or("invalid-args")?;
    let name = a.get("name").and_then(Value::as_str).unwrap_or("");
    let size = a.get("size").and_then(Value::as_f64).unwrap_or(0.0);
    let reported = a.get("type").and_then(Value::as_str).unwrap_or("");
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    const MIB: f64 = 1024.0 * 1024.0;
    let refuse = |why: &str| Ok(json!({ "refused": why }));
    // Type, then size, then the name, in the web's order (checkPicked, readAudio): the reason said is the same.
    let long = name.chars().count() > crate::mutators::FILE_NAME_LIMIT;
    match kind {
        "image" => {
            const PICKABLE: [&str; 4] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
            let by_ext = match ext.as_str() { "jpg" | "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "gif" => "image/gif", _ => "" };
            let picked = if PICKABLE.contains(&reported) { reported } else if reported.is_empty() { by_ext } else { "" };
            if picked.is_empty() { return refuse("type") }
            if size <= 0.0 || size > 10.0 * MIB { return refuse("size") }
            if long { return refuse("name") }
            let (w, h) = (a.get("width").and_then(Value::as_f64).unwrap_or(1.0), a.get("height").and_then(Value::as_f64).unwrap_or(1.0));
            let mut full = fit_within(w, h, 1920.0, 1080.0);
            full["quality"] = json!(0.9);
            let mut thumb = fit_within(w, h, 400.0, 225.0);
            thumb["quality"] = json!(0.8);
            Ok(json!({ "refused": null, "storedType": if picked == "image/jpeg" { "image/jpeg" } else { "image/webp" }, "full": full, "thumb": thumb }))
        }
        "audio" => {
            const TYPES: [&str; 6] = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm", "audio/x-m4a"];
            let by_ext = match ext.as_str() { "mp3" => "audio/mpeg", "wav" => "audio/wav", "ogg" => "audio/ogg", "m4a" => "audio/x-m4a", "mp4" | "m4b" => "audio/mp4", "webm" => "audio/webm", _ => "" };
            // As readAudio: the type reported, else (none reported) the extension's; one reported and not a sound's
            // is refused. A shell whose platform names types otherwise (a Mac's audio/vnd.wave) reports none.
            let t = if TYPES.contains(&reported) { reported } else if reported.is_empty() { by_ext } else { "" };
            if t.is_empty() { return refuse("type") }
            if size <= 0.0 || size > 20.0 * MIB { return refuse("size") }
            if long { return refuse("name") }
            // The type stored is what the bytes say (`head`, the file's first bytes); bytes that are no sound refused.
            let Some(head) = a.get("head").and_then(Value::as_array) else { return Ok(json!({ "refused": null, "contentType": t })) };
            let bytes: Vec<u8> = head.iter().map(|b| b.as_u64().unwrap_or(0).min(255) as u8).collect();
            match sniff_audio(&bytes) {
                Some(sniffed) => Ok(json!({ "refused": null, "contentType": sniffed })),
                None => refuse("type"),
            }
        }
        _ => Err("invalid-args".into()),
    }
}

/// A sound's type by its first bytes (packages/core's media.ts `sniffAudio`), or none: no sound the server takes.
fn sniff_audio(b: &[u8]) -> Option<&'static str> {
    let ascii = |from: usize, text: &str| b.len() >= from + text.len() && &b[from..from + text.len()] == text.as_bytes();
    if ascii(0, "ID3") || (b.len() >= 2 && b[0] == 0xff && b[1] & 0xe0 == 0xe0) { return Some("audio/mpeg") }
    if ascii(0, "RIFF") && ascii(8, "WAVE") { return Some("audio/wav") }
    if ascii(0, "OggS") { return Some("audio/ogg") }
    if ascii(4, "ftyp") { return Some(if ascii(8, "M4A ") { "audio/x-m4a" } else { "audio/mp4" }) }
    if b.len() >= 4 && b[..4] == [0x1a, 0x45, 0xdf, 0xa3] { return Some("audio/webm") }
    None
}

/// `deckImportView` {name, size, type?}: what a slideshow's import does with a file (the web's media/slides.ts
/// `checkPickedDeck`): `kind` pdf (drawn by the device) or pptx (drawn by the desktop host), else `refused`
/// (oldPowerpoint for a .ppt, with how to save it otherwise; type; size, over 50 MiB; name); and the most pages, 100.
pub fn deck_import(a: &Obj) -> R<Value> {
    let name = a.get("name").and_then(Value::as_str).unwrap_or("");
    let size = a.get("size").and_then(Value::as_f64).unwrap_or(0.0);
    let reported = a.get("type").and_then(Value::as_str).unwrap_or("");
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    let kind = if ext == "pdf" || reported == "application/pdf" { "pdf" }
        else if ext == "pptx" || reported == "application/vnd.openxmlformats-officedocument.presentationml.presentation" { "pptx" }
        else if ext == "ppt" || reported == "application/vnd.ms-powerpoint" { "ppt" } else { "" };
    let refused = match kind {
        "ppt" => Some("oldPowerpoint"),
        "" => Some("type"),
        _ if size <= 0.0 || size > 50.0 * 1024.0 * 1024.0 => Some("size"),
        _ if name.chars().count() > crate::mutators::FILE_NAME_LIMIT => Some("name"),
        _ => None,
    };
    Ok(json!({ "kind": refused.map_or(json!(kind), |_| Value::Null), "refused": refused, "maxPages": crate::pages::PAGES }))
}

/// `deckPagesView` {pages: [{full, thumb}]}: a deck's drawn pages as a slideshow keeps them (packages/core's
/// `pdfPages`): each the picture of its page on black, no elements.
pub fn deck_pages(a: &Obj) -> R<Value> {
    let mut blobs = Vec::new();
    let pages = crate::pages::pdf_pages(a.get("pages"), &mut blobs)?;
    Ok(serde_json::from_str(&pages.stringify()).unwrap())
}

/// `displayStatusView` {displays, sessions, online, connected}: each output's line as Utgångar shows it (the web's
/// Displays.tsx), from the live socket's last `sessions` message: a screen online or offline, nothing until the socket
/// is up (unknown is not offline); a public output, the presentation sending to it and how many watch, and whether it
/// is live (watched or sent to). Keyed by the output's id: {status: key, n?, sending?, live}.
pub fn display_status(a: &Obj) -> R<Value> {
    let displays = a.get("displays").and_then(Value::as_array).ok_or("invalid-args")?;
    let sessions = a.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default();
    let online: Vec<&str> = a.get("online").and_then(Value::as_array).map(|o| o.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let connected = a.get("connected").and_then(Value::as_bool).unwrap_or(false);
    let mut out = serde_json::Map::new();
    for d in displays {
        let id = d["id"].as_str().unwrap_or("");
        let v = if d["kind"] == "screen" {
            json!({ "status": if !connected { Value::Null } else if online.contains(&id) { json!("screens.online") } else { json!("screens.offline") }, "live": connected && online.contains(&id) })
        } else {
            let s = sessions.iter().find(|s| s["outputs"].as_array().is_some_and(|o| o.iter().any(|o| o["id"] == id)));
            let viewers = s.and_then(|s| s["outputs"].as_array().unwrap().iter().find(|o| o["id"] == id)).and_then(|o| o["viewers"].as_i64()).unwrap_or(0);
            let sending = s.and_then(|s| s["presentationName"].as_str());
            json!({ "status": if viewers == 1 { "displays.viewersOne" } else { "displays.viewersMany" }, "n": viewers,
                    "sending": sending, "live": viewers > 0 || sending.is_some() })
        };
        out.insert(id.into(), v);
    }
    Ok(Value::Object(out))
}

/// `videoImportView` {name, size, type?, codec?, duration?}: what a video's import does (the web's media/video.ts and
/// packages/core's video.ts): its `type` (the platform's, else the extension's: MP4 or MOV), and the `codec` its track
/// names (a four-letter code as the file has it: avc1 or avc3 H.264, hvc1 or hev1 HEVC), else `refused` (type; size,
/// empty or over 2 GiB; name; codec, with the `entry` the file has); the parts it goes up in (`partBytes`, 8 MiB) and
/// when its still is taken (`stillTime`: a bit into it, as the first frame is often black).
pub fn video_import(a: &Obj) -> R<Value> {
    let name = a.get("name").and_then(Value::as_str).unwrap_or("");
    let size = a.get("size").and_then(Value::as_f64).unwrap_or(0.0);
    let reported = a.get("type").and_then(Value::as_str).unwrap_or("");
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    let by_ext = match ext.as_str() { "mp4" | "m4v" => "video/mp4", "mov" => "video/quicktime", _ => "" };
    let kind = if ["video/mp4", "video/quicktime"].contains(&reported) { reported } else if reported.is_empty() || reported == "application/octet-stream" { by_ext } else { "" };
    let entry = a.get("codec").and_then(Value::as_str).unwrap_or("").trim();
    let codec = match entry { "avc1" | "avc3" => Some("h264"), "hvc1" | "hev1" => Some("hevc"), _ => None };
    let refused = if kind.is_empty() { Some("type") } else if size <= 0.0 || size > 2.0 * 1024.0 * 1024.0 * 1024.0 { Some("size") }
        else if name.chars().count() > crate::mutators::FILE_NAME_LIMIT { Some("name") } else if codec.is_none() { Some("codec") } else { None };
    let d = a.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
    let still = if d.is_finite() && d > 0.0 { 1f64.min(d / 10.0).min(d - 0.05).max(0.0) } else { 0.0 };
    Ok(json!({ "refused": refused, "type": kind, "codec": codec, "entry": entry, "partBytes": 8 * 1024 * 1024, "stillTime": still }))
}

/// Names compared as `localeCompare(…, {numeric: true})` compares file names: runs of digits by their value, the rest
/// as the language orders it (case and accents too), so "Bild 2" comes before "Bild 10".
fn numeric_names(lang: crate::collation::Lang, a: &str, b: &str) -> std::cmp::Ordering {
    fn runs(s: &str) -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.chars() {
            let d = c.is_ascii_digit();
            match out.last_mut() { Some((k, r)) if *k == d => r.push(c), _ => out.push((d, c.to_string())) }
        }
        out
    }
    let (ra, rb) = (runs(a), runs(b));
    for (x, y) in ra.iter().zip(rb.iter()) {
        let o = match (x.0, y.0) {
            (true, true) => { let (p, q) = (x.1.trim_start_matches('0'), y.1.trim_start_matches('0')); p.len().cmp(&q.len()).then_with(|| p.cmp(q)) }
            _ => crate::collation::ids(lang, &x.1, &y.1),
        };
        if o != std::cmp::Ordering::Equal { return o }
    }
    ra.len().cmp(&rb.len())
}

/// `libraryOrderView` {kind, sort, query, locale}: a library's files as its page lists them (the web's Library.tsx with
/// Images.tsx's `fileSorts`): those whose name holds `query` (any case), in the order `sort` chosen among `sorts` (the
/// first the default): newest added, oldest, name (digits by their value), and for videos the longest first, for
/// slideshows and overlays the last changed. `kind`: images, audios, videos, customSlides, overlays.
pub async fn library_order(a: &Obj) -> R<Value> {
    let kind = a.get("kind").and_then(Value::as_str).ok_or("invalid-args")?;
    let lang = crate::collation::lang(a);
    let (rows, name_key, sorts): (Value, &str, Vec<&str>) = match kind {
        "images" => (crate::media_views::images().await?, "fileName", vec!["newest", "oldest", "name"]),
        "audios" => (crate::media_views::audios().await?, "fileName", vec!["newest", "oldest", "name"]),
        "videos" => (crate::media_views::videos().await?, "fileName", vec!["newest", "oldest", "name", "length"]),
        "customSlides" => (crate::media_views::custom_slides().await?, "name", vec!["changed", "newest", "name"]),
        "overlays" => (crate::media_views::overlays().await?, "title", vec!["changed", "newest", "name"]),
        _ => return Err("invalid-args".into()),
    };
    let sort = a.get("sort").and_then(Value::as_str).filter(|s| sorts.contains(s)).unwrap_or(sorts[0]);
    let q = a.get("query").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
    let mut list: Vec<Value> = rows.as_array().cloned().unwrap_or_default().into_iter()
        .filter(|r| q.is_empty() || r[name_key].as_str().is_some_and(|n| n.to_lowercase().contains(&q))).collect();
    let num = |r: &Value, k: &str| r[k].as_f64().unwrap_or(0.0);
    // An overlay's "newest" is its place in the order made (`sort`), as the web's.
    let made = if kind == "overlays" { "sort" } else { "createdAt" };
    list.sort_by(|x, y| {
        let by_name = || numeric_names(lang, x[name_key].as_str().unwrap_or(""), y[name_key].as_str().unwrap_or(""));
        match sort {
            "newest" => num(y, made).total_cmp(&num(x, made)).then_with(by_name),
            "oldest" => num(x, made).total_cmp(&num(y, made)).then_with(by_name),
            "length" => num(y, "duration").total_cmp(&num(x, "duration")),
            "changed" => num(y, "updatedAt").total_cmp(&num(x, "updatedAt")).then_with(by_name),
            _ => by_name(),
        }
    });
    let texts = |s: &&str| json!({ "id": s, "text": format!("library.sort.{s}") });
    Ok(json!({ "rows": list, "sorts": sorts.iter().map(texts).collect::<Vec<_>>(), "sort": sort }))
}

/// `storageLimitsView`: Lagring's choices for the cache's limit, in bytes (the web's Storage.tsx), and the one until
/// another is chosen (MEDIA-R14: 2 GiB); a shell leaves out what is past its device's room.
pub fn storage_limits() -> Value {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    let limits: Vec<i64> = [0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0].iter().map(|n| (n * GIB) as i64).collect();
    json!({ "limits": limits, "default": (2.0 * GIB) as i64 })
}

/// `labelColoursView`: the swatches of a label's sheet, as Reminders' colours (the web's Labels.tsx), the last the
/// default grey a new label has; a label's own colour that is none of them is the shell's last swatch.
pub fn label_colours() -> Value {
    json!({ "swatches": ["#dc2626", "#ea580c", "#d97706", "#ca8a04", "#16a34a", "#0d9488", "#0284c7", "#2563eb", "#4f46e5", "#9333ea", "#db2777", "#6b7280"],
            "default": "#6b7280" })
}

/// `themesPageView` {role}: Teman as the page shows it (the web's Themes.tsx `themeChoices`): the two built-in themes
/// first (their names' and descriptions' keys, as the core keeps their Swedish only), then the organisation's own in
/// their order; which is the `default` (Classic where none is chosen); and each theme's `actions` in order, for one who
/// may manage themes: Använd som standard (not the default), Redigera (own), Duplicera, and Radera (own, destructive).
/// `canAdd`: + makes a theme from the default's look.
pub async fn themes_page(a: &Obj) -> R<Value> {
    let role = a.get("role").and_then(Value::as_str).ok_or("invalid-args")?;
    let manage = can(role, "ManageThemes");
    let default = crate::settings_views::default_theme_id().await?;
    let own = crate::settings_views::own_themes().await?;
    let mut themes: Vec<Value> = ["classic", "light"].iter().map(|id| json!({ "id": id, "name": null, "nameKey": format!("theme.{id}"),
        "descriptionKey": format!("theme.{id}Description"), "builtIn": true })).collect();
    let mut own_rows: Vec<Value> = own.as_array().unwrap().iter().map(|t| json!({ "id": t["id"], "name": t["name"], "nameKey": null, "descriptionKey": null, "builtIn": false })).collect();
    own_rows.sort_by(|x, y| x["sort"].as_f64().unwrap_or(0.0).total_cmp(&y["sort"].as_f64().unwrap_or(0.0)));
    themes.extend(own_rows);
    let ids: Vec<&str> = themes.iter().filter_map(|t| t["id"].as_str()).collect();
    // A default that is no theme any more (deleted) shows as Classic, as `themeOf` resolves it.
    let chosen = default.as_str().filter(|d| ids.contains(d)).unwrap_or("classic").to_string();
    for t in &mut themes {
        let (current, own) = (t["id"] == chosen.as_str(), t["builtIn"] == false);
        let mut actions = vec![];
        if manage && !current { actions.push(json!({ "id": "default", "text": "themes.useAsDefault", "icon": "tick", "destructive": false })) }
        if manage && own { actions.push(json!({ "id": "edit", "text": "themes.edit", "icon": "edit", "destructive": false })) }
        if manage { actions.push(json!({ "id": "duplicate", "text": "themes.duplicate", "icon": "duplicate", "destructive": false })) }
        if manage && own { actions.push(json!({ "id": "delete", "text": "themes.delete", "icon": "delete", "destructive": true })) }
        t["default"] = json!(current);
        t["actions"] = json!(actions);
    }
    Ok(json!({ "themes": themes, "default": chosen, "canAdd": manage }))
}

/// How long the trash keeps what is put in it (SONG-R26, PRES-R26): 30 days.
const RETENTION_DAYS: i64 = 30;
const DAY_MS: f64 = 86_400_000.0;

/// max(0, 30 − whole days since deletion), as packages/core's `daysRemaining`.
fn days_left(deleted_at: f64, now: f64) -> i64 { (RETENTION_DAYS - ((now - deleted_at) / DAY_MS).floor() as i64).max(0) }

/// Lower case for a search, as the web's `toLocaleLowerCase('sv')`.
fn fold(s: &str) -> String { s.trim().to_lowercase() }

/// `trashPageView` {role, now, kind?, query?}: the trash as the page shows it. `entries`: those of the kinds the role
/// manages, newest deletion first (then by id), of `kind` when given, and holding `query` in the name (or a song's
/// author); each with its `daysLeft` and the mutators that `restore` and `purge` it. `kinds`: the kinds there are, in
/// order, for the tabs (a tab that always says nothing is noise; a shell shows them when there are two or more);
/// `kind`: the one chosen, null when it became empty (PRES-E16); `total`: how many the role manages, which Töm
/// papperskorgen empties; `expired`: whether something is past its 30 days, so opening the page purges
/// (`purgeExpiredTrash`, PRES-R26).
pub async fn trash_page(a: &Obj) -> R<Value> {
    let role = a.get("role").and_then(Value::as_str).ok_or("invalid-args")?;
    let now = a.get("now").and_then(Value::as_f64).ok_or("invalid-args")?;
    let all = crate::lists::trash().await?;
    let of = |e: &Value| KINDS.iter().find(|k| e["kind"] == k.0).filter(|k| can(role, k.1)).copied();
    let mut mine: Vec<Value> = all.as_array().unwrap().iter().filter_map(|e| of(e).map(|k| {
        let mut e = e.clone();
        let deleted = e["deletedAt"].as_f64().unwrap_or(now);
        e["daysLeft"] = json!(days_left(deleted, now));
        e["restore"] = json!(k.2);
        e["purge"] = json!(k.3);
        e
    })).collect();
    mine.sort_by(|x, y| {
        let (dx, dy) = (x["deletedAt"].as_f64().unwrap_or(0.0), y["deletedAt"].as_f64().unwrap_or(0.0));
        dy.total_cmp(&dx).then_with(|| x["id"].as_str().unwrap_or("").encode_utf16().cmp(y["id"].as_str().unwrap_or("").encode_utf16()))
    });
    let kinds: Vec<&str> = KINDS.iter().map(|k| k.0).filter(|k| mine.iter().any(|e| e["kind"] == *k)).collect();
    let chosen = a.get("kind").and_then(Value::as_str).filter(|k| kinds.contains(k));
    let q = fold(a.get("query").and_then(Value::as_str).unwrap_or(""));
    let holds = |v: &Value| v.as_str().is_some_and(|s| s.to_lowercase().contains(&q));
    let expired = mine.iter().any(|e| e["deletedAt"].as_f64().is_some_and(|d| d <= now - RETENTION_DAYS as f64 * DAY_MS));
    let total = mine.len();
    let entries: Vec<Value> = mine.into_iter()
        .filter(|e| chosen.is_none_or(|k| e["kind"] == k))
        .filter(|e| q.is_empty() || holds(&e["name"]) || (e["kind"] == "Song" && holds(&e["detail"])))
        .collect();
    Ok(json!({ "entries": entries, "kinds": kinds, "kind": chosen, "total": total, "expired": expired }))
}
