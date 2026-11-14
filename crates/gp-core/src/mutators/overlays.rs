// packages/core/src/mutators/overlays.ts: overlays, each a slideshow's page with no background.
use super::*;
use crate::pages::{overlay_page, BLANK_PAGE};

const OVERLAYS: i64 = 200;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createOverlay" => create(a, ctx).await,
        "updateOverlay" => update(a, ctx).await,
        "deleteOverlay" => delete(a, ctx).await,
        _ => return None,
    })
}

/// `page.optional()`: the page as stored, and the blobs its pictures need; None when it is not given.
fn opt_page(a: &Obj) -> R<Option<(String, Vec<String>)>> {
    let Some(v) = a.get("page") else { return Ok(None) };
    let mut blobs = Vec::new();
    Ok(Some((overlay_page(v, &mut blobs)?.stringify(), blobs)))
}

async fn create(a: &Obj, ctx: &Ctx) -> R<()> {
    let (oid, title, page, at) = (id(a, "id")?, name(a, "title")?, opt_page(a)?, safe_int(a, "at")?);
    require(ctx, "ManageOverlays")?;
    if found("SELECT id FROM overlays WHERE id = ?", vec![json!(oid)]).await { return Ok(()) }
    let n = first(sql("SELECT count(*), max(sort) FROM overlays", vec![]).await).unwrap();
    limit(int_of(&n[0]) >= OVERLAYS)?;
    if let Some((_, blobs)) = &page { require_blobs(blobs).await? }
    let sort = if n[1].is_null() { 0 } else { int_of(&n[1]) + 1 };
    let content = page.map_or(BLANK_PAGE.to_string(), |(p, _)| p);
    sql("INSERT INTO overlays (id, title, content, image_id, sort, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
        vec![json!(oid), json!(title), json!(content), json!(sort), json!(at)]).await;
    Ok(())
}

async fn update(a: &Obj, ctx: &Ctx) -> R<()> {
    let oid = id(a, "id")?;
    let title = opt_name(a, "title")?;
    let page = opt_page(a)?;
    let at = safe_int(a, "at")?;
    require(ctx, "ManageOverlays")?;
    if let Some((_, blobs)) = &page { require_blobs(blobs).await? }
    let mut set: Vec<(&str, Value)> = vec![("updated_at", json!(at))];
    if let Some(t) = title { set.push(("title", json!(t))) }
    if let Some((p, _)) = page { set.push(("content", json!(p))) }
    update_set("overlays", set, &oid).await;
    Ok(())
}

/// Permanent, no trash: items that carried it carry none.
async fn delete(a: &Obj, ctx: &Ctx) -> R<()> {
    let oid = id(a, "id")?;
    require(ctx, "ManageOverlays")?;
    sql("UPDATE presentation_items SET overlay_id = NULL WHERE overlay_id = ?", vec![json!(oid)]).await;
    sql("DELETE FROM overlays WHERE id = ?", vec![json!(oid)]).await;
    Ok(())
}
