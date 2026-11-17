// The libraries (apps/web's Bilder, Ljud, Video, Bildspel and Overlays, and the add dialog's tabs): pictures, sounds,
// videos, slideshows and overlays, as the web's reads gave them (queries.ts, images.ts, customSlides.ts).
use crate::args::*;
use crate::bridge::sql;
use crate::live_views::{video_row, AUDIO, VIDEO};
use crate::rows::{columns, map, K, OVERLAY};
use serde_json::{json, Value};

/// `LibraryImage`, its content type read as the web reads it.
pub const IMAGE: &[(&str, K)] = &[("id", K::Str), ("fileName", K::Str), ("contentType", K::Opt), ("fullHash", K::Str), ("thumbHash", K::Str),
    ("width", K::Num), ("height", K::Num), ("createdAt", K::Num), ("deletedAt", K::Opt), ("originalFullHash", K::Opt), ("originalThumbHash", K::Opt),
    ("originalWidth", K::Opt), ("originalHeight", K::Opt), ("edit", K::Opt)];

/// `libraryImage`.
pub fn image_row(r: &[Value]) -> Value {
    let mut v = map(r, IMAGE);
    v["contentType"] = json!(if v["contentType"] == "image/jpeg" { "image/jpeg" } else { "image/webp" });
    v
}

/// The rows of `fields` from `table`, without the trash, newest first (MEDIA-R7).
async fn newest(fields: &[(&str, K)], table: &str) -> Vec<Vec<Value>> {
    sql(&format!("SELECT {} FROM {table} WHERE deleted_at IS NULL ORDER BY created_at DESC, id", columns(fields)), vec![]).await
}

/// `imagesView`: the pictures (`listImages`).
pub async fn images() -> R<Value> { Ok(Value::Array(newest(IMAGE, "images").await.iter().map(|r| image_row(r)).collect())) }
/// `audiosView`: the sounds (`listAudios`).
pub async fn audios() -> R<Value> { Ok(Value::Array(newest(AUDIO, "audios").await.iter().map(|r| map(r, AUDIO)).collect())) }
/// `videosView`: the videos (`listVideos`).
pub async fn videos() -> R<Value> { Ok(Value::Array(newest(VIDEO, "videos").await.iter().map(|r| video_row(r)).collect())) }

/// `customSlide`: a slideshow, its pages as stored or one blank page where they do not read (`parseCustomPages`).
fn custom_slide(r: &[Value]) -> Value {
    let pages = r[2].as_str().and_then(|p| serde_json::from_str::<Value>(p).ok())
        .and_then(|v| crate::pages::pages(Some(&v), &mut Vec::new()).ok())
        .and_then(|p| serde_json::from_str(&p.stringify()).ok())
        .unwrap_or_else(|| json!([{ "background": null, "backgroundPicture": null, "backgroundPage": null, "elements": [] }]));
    let mut v = map(r, CUSTOM);
    v["pages"] = pages;
    v
}

const CUSTOM: &[(&str, K)] = &[("id", K::Str), ("name", K::Str), ("pages", K::Opt), ("createdAt", K::Num), ("updatedAt", K::Num), ("deletedAt", K::Opt)];

/// `customSlidesView`: the slideshows by name, any case, without the trash (`listCustomSlides`).
pub async fn custom_slides() -> R<Value> {
    Ok(Value::Array(sql(&format!("SELECT {} FROM custom_slides WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id", columns(CUSTOM)), vec![]).await
        .iter().map(|r| custom_slide(r)).collect()))
}

/// `customSlideView` {id}: a slideshow, trashed or not, null when there is none (`getCustomSlide`).
pub async fn custom_slide_view(a: &Obj) -> R<Value> {
    let id = id(a, "id")?;
    Ok(sql(&format!("SELECT {} FROM custom_slides WHERE id = ?", columns(CUSTOM)), vec![json!(id)]).await.first().map_or(Value::Null, |r| custom_slide(r)))
}

/// `overlaysView`: the overlays in the order they were made (`listOverlays`, PRES-R18).
pub async fn overlays() -> R<Value> { Ok(crate::presentation_page::overlays().await) }

/// `overlayRowView` {id}: an overlay's row, null when there is none (`getOverlay`).
pub async fn overlay_row(a: &Obj) -> R<Value> {
    let id = id(a, "id")?;
    Ok(sql(&format!("SELECT {} FROM overlays WHERE id = ?", columns(OVERLAY)), vec![json!(id)]).await.first().map_or(Value::Null, |r| {
        let mut o = map(r, OVERLAY);
        o["imageId"] = Value::Null;
        o
    }))
}
