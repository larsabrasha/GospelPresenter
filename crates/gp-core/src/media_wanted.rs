// Which media files a device fetches and keeps (docs/media-and-files.md, "Which files a device keeps"): the web's
// `wantedBlobs` and `wantedVideos` (packages/sync/src/client/media.ts), so every shell fetches the same. Every picture's
// and video's thumbnail, always; a theme's and every slideshow's and overlay's pictures as their thumbnails; and, for
// the presentation presented and those kept offline, the files it needs live: full pictures, audio, videos' stills
// and slideshow pages, with every overlay's and theme's full picture. A video itself only where it is kept offline
// (it streams from the host otherwise).
use crate::args::*;
use crate::bridge::sql;
use crate::mutators::{int_of, s};
use serde_json::{json, Value};

/// Every picture a page of a set of pages draws (`pagePictures`, packages/core/src/media.ts): its PDF page, its
/// background picture and its pictures, each a row of `full_hash` and `thumb_hash` and the columns `cols` of `from`,
/// which names its pages `pg`.
fn page_pictures(cols: &str, from: &str, at_where: &str) -> String {
    let mut parts: Vec<String> = ["$.backgroundPage", "$.backgroundPicture"].iter().map(|at| format!(
        "SELECT {cols}json_extract(pg.value, '{at}.full') AS full_hash, json_extract(pg.value, '{at}.thumb') AS thumb_hash\n  FROM {from} WHERE {at_where} AND json_extract(pg.value, '{at}') IS NOT NULL"
    )).collect();
    parts.push(format!(
        "SELECT {cols}json_extract(e.value, '$.picture.full') AS full_hash, json_extract(e.value, '$.picture.thumb') AS thumb_hash\n  FROM {from}, json_each(pg.value, '$.elements') e WHERE {at_where} AND json_extract(e.value, '$.kind') = 'image'"
    ));
    parts.join("\n  UNION ALL\n  ")
}

/// A column's JSON for `json_each`, or null (no rows) where it does not read: one row that does not read would stop the
/// whole query, and with it every file a device fetches (`readable`, Lars, 2026-11-20).
fn readable(column: &str) -> String { format!("CASE WHEN json_valid({column}) THEN {column} END") }

/// `SLIDE_PAGES_SQL`: every picture of every slideshow a presentation's items name, with the presentation.
fn slide_pages() -> String {
    page_pictures("p.presentation_id, ", &format!("presentation_items p JOIN custom_slides c ON c.id = p.source_id, json_each({}) pg", readable("c.pages")), "p.type = 'custom'")
}

/// `SLIDESHOW_PICTURES_SQL`: every picture of every slideshow of the library, the trash too.
fn slideshow_pictures() -> String { page_pictures("", &format!("custom_slides c, json_each({}) pg", readable("c.pages")), "1") }

/// `OVERLAY_PICTURES_SQL`: every picture an overlay's page draws, with the overlay and its place in the list.
fn overlay_pictures() -> String {
    page_pictures("o.id AS overlay_id, o.sort, ", "overlays o, json_each(CASE WHEN json_valid(o.content) THEN json_array(json(o.content)) END) pg", "1")
}

/// `THEME_PICTURES_SQL`: every background picture of the organisation's own themes, a row per picture.
fn theme_pictures() -> String {
    ["$.song.background.image", "$.bible.background.image", "$.media.image"].iter().map(|at| format!(
        "SELECT t.id AS theme_id, json_extract(t.definition, '{at}.full') AS full_hash, json_extract(t.definition, '{at}.thumb') AS thumb_hash\n  FROM themes t WHERE json_valid(t.definition) AND json_extract(t.definition, '{at}.kind') = 'picture'"
    )).collect::<Vec<_>>().join("\n  UNION ALL\n  ")
}

/// `ITEM_IMAGES_SQL`: every picture of every image item, with its presentation.
const ITEM_IMAGES: &str = "SELECT p.presentation_id, p.source_id AS image_id FROM presentation_items p WHERE p.type = 'image' AND p.content IS NULL
  UNION ALL
  SELECT p.presentation_id, j.value AS image_id FROM presentation_items p, json_each(CASE WHEN json_valid(p.content) THEN p.content END, '$.images') j WHERE p.type = 'image' AND p.content IS NOT NULL";

/// The policy as the shell gives it (`MediaPolicy`).
struct Policy { presenting: Option<String>, persistent: bool, keep_coming: bool, today: String, days: i64, fetch: bool }

/// `addDays`: a plain date `YYYY-MM-DD` plus `days`, in the calendar.
fn add_days(date: &str, days: i64) -> String {
    let n: Vec<i64> = date.split('-').map(|p| p.parse().unwrap_or(0)).collect();
    let (y, m, d) = (n.first().copied().unwrap_or(1970), n.get(1).copied().unwrap_or(1), n.get(2).copied().unwrap_or(1));
    // Days from 1970-01-01 to a civil date, and back (Howard Hinnant's algorithms), as Date.UTC counts them.
    let from_civil = |y: i64, m: i64, d: i64| {
        let y = if m <= 2 { y - 1 } else { y };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
    };
    // A month past its end (as `Date.UTC` takes it): counted on from the month's first day.
    let (y, m) = (y + (m - 1).div_euclid(12), (m - 1).rem_euclid(12) + 1);
    let z = from_civil(y, m, 1) + d - 1 + days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02}")
}

async fn column(q: &str, params: Vec<Value>) -> Vec<String> {
    sql(q, params).await.into_iter().map(|r| s(&r[0])).collect()
}

/// `keptPresentations`: those chosen by hand, and, with `keepComing`, those dated from today to `days` ahead.
async fn kept(p: &Policy) -> Vec<String> {
    if !p.persistent { return vec![] }
    let mut ids = column("SELECT p.id FROM pinned_presentations k JOIN presentations p ON p.id = k.id WHERE p.deleted_at IS NULL ORDER BY k.pinned_at", vec![]).await;
    if p.keep_coming {
        ids.extend(column("SELECT id FROM presentations WHERE deleted_at IS NULL AND is_template = 0 AND event_date >= ? AND event_date <= ? ORDER BY event_date",
            vec![json!(p.today), json!(add_days(&p.today, p.days))]).await);
    }
    unique(ids)
}

fn unique(xs: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    xs.into_iter().filter(|x| seen.insert(x.clone())).collect()
}

/// `presentationFiles`: every file a presentation needs live but its videos.
async fn presentation_files(id: &str) -> Vec<String> {
    let pages = slide_pages();
    let q = format!(
        "SELECT i.full_hash AS hash FROM ({ITEM_IMAGES}) p JOIN images i ON i.id = p.image_id
       WHERE p.presentation_id = ?
     UNION ALL
     SELECT a.hash AS hash FROM presentation_items p JOIN audios a ON a.id = p.source_id
       WHERE p.presentation_id = ? AND p.type = 'audio'
     UNION ALL
     SELECT v.still_hash AS hash FROM presentation_items p JOIN videos v ON v.id = p.source_id
       WHERE p.presentation_id = ? AND p.type = 'video'
     UNION ALL
     SELECT s.thumb_hash AS hash FROM ({pages}) s WHERE s.presentation_id = ?
     UNION ALL
     SELECT s.full_hash AS hash FROM ({pages}) s WHERE s.presentation_id = ?"
    );
    column(&q, vec![json!(id); 5]).await
}

/// `wantedMediaView` {presenting, persistent, keepComing, today, days, fetch}: the blobs this device should hold now,
/// in the order to fetch them (`wantedBlobs`), and the videos it keeps whole (`wantedVideos`, each {hash, size}).
pub async fn view(a: &Obj) -> R<Value> {
    let p = Policy {
        presenting: opt_id(a, "presenting")?,
        persistent: a.get("persistent").and_then(Value::as_bool).unwrap_or(true),
        keep_coming: a.get("keepComing").and_then(Value::as_bool).unwrap_or(false),
        today: a.get("today").and_then(Value::as_str).unwrap_or("").to_string(),
        days: a.get("days").and_then(Value::as_i64).unwrap_or(7),
        fetch: a.get("fetch").and_then(Value::as_bool).unwrap_or(true),
    };
    if !p.fetch { return Ok(json!({ "blobs": [], "videos": [] })) }
    let mut hashes = column("SELECT hash FROM (SELECT thumb_hash AS hash, created_at FROM images UNION ALL SELECT thumb_hash AS hash, created_at FROM videos) ORDER BY created_at DESC", vec![]).await;
    for q in [theme_pictures(), slideshow_pictures()] {
        hashes.extend(column(&format!("SELECT thumb_hash AS hash FROM ({q}) WHERE thumb_hash IS NOT NULL"), vec![]).await);
    }
    let overlays = sql(&format!("SELECT full_hash, thumb_hash FROM ({}) ORDER BY sort", overlay_pictures()), vec![]).await;
    hashes.extend(overlays.iter().filter(|o| !o[1].is_null()).map(|o| s(&o[1])));
    let kept_ids = kept(&p).await;
    let order = unique(p.presenting.iter().cloned().chain(kept_ids.iter().cloned()).collect());
    if !order.is_empty() {
        hashes.extend(overlays.iter().map(|o| s(&o[0])));
        hashes.extend(column(&format!("SELECT full_hash AS hash FROM ({})", theme_pictures()), vec![]).await);
    }
    for id in &order { hashes.extend(presentation_files(id).await) }
    let videos = if kept_ids.is_empty() { vec![] } else {
        let marks = kept_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        sql(&format!("SELECT DISTINCT v.hash, v.size FROM presentation_items p JOIN videos v ON v.id = p.source_id WHERE p.type = 'video' AND p.presentation_id IN ({marks})"),
            kept_ids.iter().map(|k| json!(k)).collect()).await
            .into_iter().map(|r| json!({ "hash": s(&r[0]), "size": int_of(&r[1]) })).collect()
    };
    Ok(json!({ "blobs": unique(hashes), "videos": videos }))
}

#[cfg(test)]
mod tests {
    use super::add_days;

    #[test]
    fn adds_days_across_a_month_and_a_year() {
        assert_eq!([add_days("2026-11-29", 7), add_days("2026-12-28", 7), add_days("2024-02-27", 2), add_days("2026-01-01", 0)],
            ["2026-12-06", "2027-01-04", "2024-02-29", "2026-01-01"]);
    }
}
