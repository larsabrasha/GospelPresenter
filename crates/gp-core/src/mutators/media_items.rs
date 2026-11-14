// media.ts's items of a running order that show the library: pictures (one item, a slide each), a sound, a video.
use super::*;
use super::presentations::{change_presentation, insert_item, Item};
use crate::json::string_list;

const MAX_ITEM_IMAGES: usize = 50;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "addImageToPresentation" => add_images(a, ctx).await,
        "addImagesToItem" => add_to_item(a, ctx).await,
        "removeItemImage" => remove_image(a, ctx).await,
        "moveItemImage" => move_image(a, ctx).await,
        "addAudioToPresentation" => add_file(a, ctx, "audio").await,
        "addVideoToPresentation" => add_file(a, ctx, "video").await,
        _ => return None,
    })
}

/// `imageIds`: 1 to 50 pictures.
fn image_ids(a: &Obj) -> R<Vec<String>> {
    let list = ids(a, "imageIds", MAX_ITEM_IMAGES)?;
    if list.is_empty() { Err("invalid-args".into()) } else { Ok(list) }
}

/// What an image item of several pictures keeps.
fn content_of(ids: &[String]) -> Option<String> { (ids.len() > 1).then(|| format!(r#"{{"images":{}}}"#, string_list(ids))) }

async fn add_images(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, pid) = (id(a, "itemId")?, id(a, "presentationId")?);
    let several = if a.contains_key("imageIds") { Some(image_ids(a)?) } else { None };
    let one = if a.contains_key("imageId") { Some(id(a, "imageId")?) } else { None };
    let title = if a.contains_key("title") { Some(trimmed(a, "title", 1, 200)?) } else { None };
    let after = opt_id(a, "afterItemId")?;
    require(ctx, "ManagePresentations")?;
    require(ctx, "ViewImages")?;
    let ids = several.or(one.map(|i| vec![i])).unwrap_or_default();
    if ids.is_empty() { return Err("invalid".into()) }
    change_presentation(&pid, ctx).await?;
    let first_image = first(sql("SELECT file_name FROM images WHERE id = ?", vec![json!(ids[0])]).await).ok_or("not-found")?;
    let title = if ids.len() == 1 { s(&first_image[0]) } else { title.unwrap_or_else(|| ids.len().to_string()) };
    let item = Item { id: item_id, presentation_id: pid, kind: "image", title, source_id: ids[0].clone(), arrangement_id: None, content: content_of(&ids) };
    insert_item(after, item, None).await?;
    Ok(())
}

/// `imageItemIds`: an image item's pictures, by library id, in order; its `sourceId` alone where its content does not read.
fn item_ids(source: &str, content: Option<&str>) -> Vec<String> {
    let Some(c) = content.filter(|c| !c.is_empty()) else { return vec![source.into()] };
    let images = serde_json::from_str::<Value>(c).ok().and_then(|v| v.as_object().and_then(|o| o.get("images")).cloned());
    let read = images.as_ref().and_then(Value::as_array).filter(|xs| (1..=MAX_ITEM_IMAGES).contains(&xs.len()))
        .and_then(|xs| xs.iter().map(|x| x.as_str().filter(|s| (1..=64).contains(&s.chars().count())).map(String::from)).collect::<Option<Vec<_>>>());
    read.unwrap_or_else(|| vec![source.into()])
}

/// An image item, by id, with its pictures; None when it is gone or not an image item.
async fn image_item(item_id: &str, ctx: &Ctx) -> R<Option<Vec<String>>> {
    let Some(item) = first(sql("SELECT presentation_id, type, source_id, content FROM presentation_items WHERE id = ?", vec![json!(item_id)]).await) else { return Ok(None) };
    if item[1].as_str() != Some("image") { return Ok(None) }
    change_presentation(&s(&item[0]), ctx).await?;
    Ok(Some(item_ids(&s(&item[2]), item[3].as_str())))
}

/// Writes an image item's pictures; none left removes the item.
async fn set_item_images(item_id: &str, ids: &[String]) {
    if ids.is_empty() {
        sql("DELETE FROM presentation_items WHERE id = ?", vec![json!(item_id)]).await;
        return;
    }
    sql("UPDATE presentation_items SET source_id = ?, content = ? WHERE id = ?", vec![json!(ids[0]), json!(content_of(ids)), json!(item_id)]).await;
}

async fn add_to_item(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, more) = (id(a, "itemId")?, image_ids(a)?);
    require(ctx, "ManagePresentations")?;
    require(ctx, "ViewImages")?;
    let Some(mut ids) = image_item(&item_id, ctx).await? else { return Ok(()) };
    limit(ids.len() + more.len() > MAX_ITEM_IMAGES)?;
    ids.extend(more);
    set_item_images(&item_id, &ids).await;
    Ok(())
}

async fn remove_image(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, at) = (id(a, "itemId")?, index(a, "index")?);
    require(ctx, "ManagePresentations")?;
    let Some(mut ids) = image_item(&item_id, ctx).await? else { return Ok(()) };
    if at >= ids.len() { return Ok(()) }
    ids.remove(at);
    set_item_images(&item_id, &ids).await;
    Ok(())
}

async fn move_image(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, from, to) = (id(a, "itemId")?, index(a, "from")?, index(a, "to")?);
    require(ctx, "ManagePresentations")?;
    let Some(mut ids) = image_item(&item_id, ctx).await? else { return Ok(()) };
    if from >= ids.len() || to >= ids.len() || from == to { return Ok(()) }
    let moved = ids.remove(from);
    ids.insert(to, moved);
    set_item_images(&item_id, &ids).await;
    Ok(())
}

/// A sound or a video as an item: a reference, like a picture, so a trashed file still plays.
async fn add_file(a: &Obj, ctx: &Ctx, kind: &'static str) -> R<()> {
    let key = if kind == "audio" { "audioId" } else { "videoId" };
    let (item_id, pid, fid, after) = (id(a, "itemId")?, id(a, "presentationId")?, id(a, key)?, opt_id(a, "afterItemId")?);
    let (table, permission) = if kind == "audio" { ("audios", "ViewAudios") } else { ("videos", "ViewVideos") };
    require(ctx, "ManagePresentations")?;
    require(ctx, permission)?;
    change_presentation(&pid, ctx).await?;
    let f = first(sql(&format!("SELECT file_name FROM {table} WHERE id = ?"), vec![json!(fid)]).await).ok_or("not-found")?;
    insert_item(after, Item { id: item_id, presentation_id: pid, kind, title: s(&f[0]), source_id: fid, arrangement_id: None, content: None }, None).await?;
    Ok(())
}
