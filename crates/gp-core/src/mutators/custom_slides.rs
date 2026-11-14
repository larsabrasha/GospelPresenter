// packages/core/src/mutators/custom-slides.ts: slideshows (Bildspel) in the library, a PDF's among them, and items
// that show one.
use super::*;
use super::presentations::{change_presentation, insert_item, Item};
use crate::pages::{pages, pdf_pages};

const SLIDES: i64 = 1000;
const FILE_NAME: usize = 200;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createCustomSlide" => create(a, ctx).await,
        "updateCustomSlide" => update(a, ctx).await,
        "trashCustomSlide" => set_deleted(a, ctx, true).await,
        "restoreCustomSlide" => set_deleted(a, ctx, false).await,
        "purgeCustomSlide" => purge(a, ctx).await,
        "addCustomSlideToPresentation" => add_to_presentation(a, ctx).await,
        "addSlides" => add_slides(a, ctx).await,
        _ => return None,
    })
}

/// `insertSlide`: a new slideshow, unless it is there (a replay); at most SLIDES, the trash not counted.
async fn insert_slide(sid: &str, name: &str, pages: &str, blobs: &[String], at: i64) -> R<()> {
    if found("SELECT id FROM custom_slides WHERE id = ?", vec![json!(sid)]).await { return Ok(()) }
    let n = int_of(&first(sql("SELECT count(*) FROM custom_slides WHERE deleted_at IS NULL", vec![]).await).unwrap()[0]);
    limit(n >= SLIDES)?;
    require_blobs(blobs).await?;
    sql("INSERT INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)",
        vec![json!(sid), json!(name), json!(pages), json!(at), json!(at)]).await;
    Ok(())
}

async fn create(a: &Obj, ctx: &Ctx) -> R<()> {
    let mut blobs = Vec::new();
    let (sid, name, pages, at) = (id(a, "id")?, name(a, "name")?, pages(a.get("pages"), &mut blobs)?, safe_int(a, "at")?);
    require(ctx, "ManagePresentations")?;
    insert_slide(&sid, &name, &pages.stringify(), &blobs, at).await
}

async fn update(a: &Obj, ctx: &Ctx) -> R<()> {
    let mut blobs = Vec::new();
    let sid = id(a, "id")?;
    let name = opt_name(a, "name")?;
    let pages = if a.contains_key("pages") { Some(pages(a.get("pages"), &mut blobs)?) } else { None };
    let at = safe_int(a, "at")?;
    require(ctx, "ManagePresentations")?;
    if pages.is_some() { require_blobs(&blobs).await? }
    let mut set: Vec<(&str, Value)> = vec![("updated_at", json!(at))];
    if let Some(n) = name { set.push(("name", json!(n))) }
    if let Some(p) = pages { set.push(("pages", json!(p.stringify()))) }
    update_set("custom_slides", set, &sid).await;
    Ok(())
}

async fn set_deleted(a: &Obj, ctx: &Ctx, trash: bool) -> R<()> {
    let sid = id(a, "id")?;
    let at = if trash { json!(safe_int(a, "at")?) } else { Value::Null };
    require(ctx, "ManagePresentations")?;
    sql("UPDATE custom_slides SET deleted_at = ? WHERE id = ?", vec![at, json!(sid)]).await;
    Ok(())
}

async fn purge(a: &Obj, ctx: &Ctx) -> R<()> {
    let sid = id(a, "id")?;
    require(ctx, "ManagePresentations")?;
    let Some(row) = first(sql("SELECT deleted_at FROM custom_slides WHERE id = ?", vec![json!(sid)]).await) else { return Ok(()) };
    if row[0].is_null() { return Err("not-in-trash".into()) }
    sql("DELETE FROM custom_slides WHERE id = ?", vec![json!(sid)]).await;
    Ok(())
}

async fn add_to_presentation(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, pid, sid, after) = (id(a, "itemId")?, id(a, "presentationId")?, id(a, "slideId")?, opt_id(a, "afterItemId")?);
    require(ctx, "ManagePresentations")?;
    change_presentation(&pid, ctx).await?;
    let s = first(sql("SELECT name FROM custom_slides WHERE id = ?", vec![json!(sid)]).await).ok_or("not-found")?;
    insert_item(after, Item { id: item_id, presentation_id: pid, kind: "custom", title: super::s(&s[0]), source_id: sid, arrangement_id: None, content: None }, None).await?;
    Ok(())
}

/// A PDF into a presentation: its pages a slideshow of the library, and an item that names it, in one step.
async fn add_slides(a: &Obj, ctx: &Ctx) -> R<()> {
    let mut blobs = Vec::new();
    let (item_id, pid) = (id(a, "itemId")?, id(a, "presentationId")?);
    let deck = if a.contains_key("deckId") { Some(id(a, "deckId")?) } else { None };
    let file_name = trimmed(a, "fileName", 1, FILE_NAME)?;
    let pages = pdf_pages(a.get("pages"), &mut blobs)?;
    let after = opt_id(a, "afterItemId")?;
    let at = if a.contains_key("at") { safe_int(a, "at")? } else { 0 };
    require(ctx, "ManagePresentations")?;
    change_presentation(&pid, ctx).await?;
    let sid = deck.unwrap_or_else(|| item_id.clone());
    insert_slide(&sid, &file_name, &pages.stringify(), &blobs, at).await?;
    insert_item(after, Item { id: item_id, presentation_id: pid, kind: "custom", title: file_name, source_id: sid, arrangement_id: None, content: None }, None).await?;
    Ok(())
}
