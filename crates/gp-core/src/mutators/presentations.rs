// packages/core/src/mutators/presentations.ts: the running order's mutators, on the shell's SQLite.
use super::*;
use crate::bridge::sql;
use serde_json::{json, Value};

const ITEMS_PER_PRESENTATION: i64 = 100;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createPresentation" => create_presentation(a, ctx).await,
        "renamePresentation" => rename_presentation(a, ctx).await,
        "addSongToPresentation" => add_song(a, ctx).await,
        "addBibleToPresentation" => crate::bible::add_bible(a, ctx).await,
        "addHeaderToPresentation" => add_header(a, ctx).await,
        "moveItem" => move_item(a, ctx).await,
        "reorderItems" => reorder_items(a, ctx).await,
        "removeItem" => remove_item(a, ctx).await,
        "updatePresentation" => update_presentation(a, ctx).await,
        "renameItem" => rename_item(a, ctx).await,
        "setItemNote" => set_item_note(a, ctx).await,
        "setItemArrangement" => set_item_arrangement(a, ctx).await,
        "setItemOverlay" => set_item_overlay(a, ctx).await,
        "trashPresentation" => set_deleted(a, ctx, true).await,
        "restorePresentation" => set_deleted(a, ctx, false).await,
        "purgePresentation" => purge_presentation(a, ctx).await,
        _ => return None,
    })
}

async fn create_presentation(a: &Obj, ctx: &Ctx) -> R<()> {
    let (id, name) = (id(a, "id")?, name(a, "name")?);
    let (date, time) = (opt_date(a, "eventDate")?, opt_time(a, "time")?);
    let (location, description) = (opt_text(a, "location", 100)?, opt_text(a, "description", 5000)?);
    require(ctx, "ManagePresentations")?;
    sql("INSERT INTO presentations (id, name, event_date, time, location, description, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        vec![json!(id), json!(name), json!(date), json!(time), json!(location), json!(description), changed_at(ctx)]).await;
    Ok(())
}

/// A presentation's new name; a template is renamed with `updateTemplate`.
async fn rename_presentation(a: &Obj, ctx: &Ctx) -> R<()> {
    let (pid, name) = (id(a, "id")?, name(a, "name")?);
    require(ctx, "ManagePresentations")?;
    sql("UPDATE presentations SET name = ?, updated_at = ? WHERE id = ? AND is_template = 0", vec![json!(name), changed_at(ctx), json!(pid)]).await;
    Ok(())
}

/// The presentation whose running order is about to change; a template needs ManageTemplates.
pub async fn change_presentation(pid: &str, ctx: &Ctx) -> R<()> {
    let p = first(sql("SELECT is_template FROM presentations WHERE id = ?", vec![json!(pid)]).await).ok_or("not-found")?;
    if int_of(&p[0]) != 0 { require(ctx, "ManageTemplates")?; }
    sql("UPDATE presentations SET updated_at = ? WHERE id = ?", vec![changed_at(ctx), json!(pid)]).await;
    Ok(())
}

pub struct Item { pub id: String, pub presentation_id: String, pub kind: &'static str, pub title: String, pub source_id: String, pub arrangement_id: Option<String>, pub content: Option<String> }

/// Inserts after `after`, or before `before`, or last; false for a replay.
pub async fn insert_item(after: Option<String>, item: Item, before: Option<String>) -> R<bool> {
    if first(sql("SELECT id FROM presentation_items WHERE id = ?", vec![json!(item.id)]).await).is_some() { return Ok(false); }
    let n = first(sql("SELECT count(*), max(sort) FROM presentation_items WHERE presentation_id = ?", vec![json!(item.presentation_id)]).await).unwrap();
    if int_of(&n[0]) >= ITEMS_PER_PRESENTATION { return Err("limit".into()); }
    let mut sort = if n[1].is_null() { 0 } else { int_of(&n[1]) + 1 };
    let pid = json!(item.presentation_id);
    let before_row = match &before {
        Some(b) => first(sql("SELECT sort FROM presentation_items WHERE id = ? AND presentation_id = ?", vec![json!(b), pid.clone()]).await),
        None => None,
    };
    if let Some(b) = before_row {
        sort = int_of(&b[0]);
        sql("UPDATE presentation_items SET sort = sort + 1 WHERE presentation_id = ? AND sort >= ?", vec![pid.clone(), json!(sort)]).await;
    } else if let Some(after) = after {
        if let Some(r) = first(sql("SELECT sort FROM presentation_items WHERE id = ? AND presentation_id = ?", vec![json!(after), pid.clone()]).await) {
            let s = int_of(&r[0]);
            sort = s + 1;
            sql("UPDATE presentation_items SET sort = sort + 1 WHERE presentation_id = ? AND sort > ?", vec![pid.clone(), json!(s)]).await;
        }
    }
    sql("INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort, arrangement_id, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        vec![json!(item.id), pid, json!(item.kind), json!(item.title), json!(item.source_id), json!(sort), json!(item.arrangement_id), json!(item.content)]).await;
    Ok(true)
}

async fn add_song(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, pid, song_id) = (id(a, "itemId")?, id(a, "presentationId")?, id(a, "songId")?);
    let (arrangement, after) = (opt_id(a, "arrangementId")?, opt_id(a, "afterItemId")?);
    require(ctx, "ManagePresentations")?;
    change_presentation(&pid, ctx).await?;
    let s = first(sql("SELECT name FROM songs WHERE id = ?", vec![json!(song_id)]).await).ok_or("not-found")?;
    let own = match arrangement {
        Some(arr) => first(sql("SELECT id FROM song_arrangements WHERE id = ? AND song_id = ?", vec![json!(arr), json!(song_id)]).await).map(|r| r[0].as_str().unwrap().to_string()),
        None => None,
    };
    let title = s[0].as_str().unwrap_or("").to_string();
    insert_item(after, Item { id: item_id, presentation_id: pid, kind: "song", title, source_id: song_id, arrangement_id: own, content: None }, None).await?;
    Ok(())
}

async fn add_header(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, pid, title) = (id(a, "itemId")?, id(a, "presentationId")?, name(a, "title")?);
    let (after, before) = (opt_id(a, "afterItemId")?, opt_id(a, "beforeItemId")?);
    require(ctx, "ManagePresentations")?;
    change_presentation(&pid, ctx).await?;
    insert_item(after, Item { source_id: item_id.clone(), id: item_id, presentation_id: pid, kind: "header", title, arrangement_id: None, content: None }, before).await?;
    Ok(())
}

async fn order_of(pid: &Value) -> Vec<String> {
    sql("SELECT id FROM presentation_items WHERE presentation_id = ? ORDER BY sort ASC, id ASC", vec![pid.clone()]).await
        .into_iter().map(|r| r[0].as_str().unwrap().to_string()).collect()
}

async fn write_order(order: &[String]) {
    for (i, item) in order.iter().enumerate() {
        sql("UPDATE presentation_items SET sort = ? WHERE id = ? AND sort <> ?", vec![json!(i), json!(item), json!(i)]).await;
    }
}

async fn move_item(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, by) = (id(a, "itemId")?, int(a, "by", -1000, 1000)?);
    require(ctx, "ManagePresentations")?;
    let Some(item) = first(sql("SELECT presentation_id FROM presentation_items WHERE id = ?", vec![json!(item_id)]).await) else { return Ok(()) };
    let pid = item[0].clone();
    change_presentation(pid.as_str().unwrap(), ctx).await?;
    let mut order = order_of(&pid).await;
    let at = order.iter().position(|x| *x == item_id).unwrap() as i64;
    let to = (at + by).min(order.len() as i64 - 1).max(0) as usize;
    order.remove(at as usize);
    order.insert(to, item_id);
    write_order(&order).await;
    Ok(())
}

async fn reorder_items(a: &Obj, ctx: &Ctx) -> R<()> {
    let (pid, wanted) = (id(a, "presentationId")?, ids(a, "itemIds", 1000)?);
    require(ctx, "ManagePresentations")?;
    change_presentation(&pid, ctx).await?;
    let current = order_of(&json!(pid)).await;
    let named: Vec<String> = wanted.into_iter().filter(|x| current.contains(x)).collect();
    let rest = current.into_iter().filter(|x| !named.contains(x));
    let order: Vec<String> = named.iter().cloned().chain(rest).collect();
    write_order(&order).await;
    Ok(())
}

async fn remove_item(a: &Obj, ctx: &Ctx) -> R<()> {
    let item_id = id(a, "itemId")?;
    require(ctx, "ManagePresentations")?;
    if !require_item(&item_id, ctx).await? { return Ok(()) }
    sql("DELETE FROM presentation_items WHERE id = ?", vec![json!(item_id)]).await;
    Ok(())
}

/// The details dialog: sets the fields it names, a null clearing one; a template is not changed here.
async fn update_presentation(a: &Obj, ctx: &Ctx) -> R<()> {
    let pid = id(a, "id")?;
    let name = opt_name(a, "name")?;
    let date = field(a, "eventDate", opt_date)?;
    let time = field(a, "time", opt_time)?;
    let location = field(a, "location", |o, k| opt_text(o, k, 100))?;
    let description = field(a, "description", |o, k| opt_text(o, k, 5000))?;
    let theme = field(a, "themeId", opt_id)?;
    require(ctx, "ManagePresentations")?;
    if let Some(theme) = &theme {
        require(ctx, "ViewThemes")?;
        if let Some(t) = theme {
            if t != "classic" && t != "light" && first(sql("SELECT id FROM themes WHERE id = ?", vec![json!(t)]).await).is_none() {
                return Err("theme-not-found".into());
            }
        }
    }
    let mut set: Vec<(&str, Value)> = Vec::new();
    if let Some(n) = name { set.push(("name", json!(n))) }
    for (col, v) in [("event_date", date), ("time", time), ("location", location), ("description", description), ("theme_id", theme)] {
        if let Some(v) = v { set.push((col, json!(v))) }
    }
    if set.is_empty() { return Ok(()) }
    set.push(("updated_at", changed_at(ctx)));
    let cols: Vec<String> = set.iter().map(|(c, _)| format!("{c} = ?")).collect();
    let mut params: Vec<Value> = set.into_iter().map(|(_, v)| v).collect();
    params.push(json!(pid));
    sql(&format!("UPDATE presentations SET {} WHERE id = ? AND is_template = 0", cols.join(", ")), params).await;
    Ok(())
}

/// `requireItem`: the item's presentation marked changed; false when the item is gone.
async fn require_item(item_id: &str, ctx: &Ctx) -> R<bool> {
    let Some(item) = first(sql("SELECT presentation_id FROM presentation_items WHERE id = ?", vec![json!(item_id)]).await) else { return Ok(false) };
    change_presentation(item[0].as_str().unwrap(), ctx).await?;
    Ok(true)
}

async fn rename_item(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, title) = (id(a, "itemId")?, name(a, "title")?);
    require(ctx, "ManagePresentations")?;
    if !require_item(&item_id, ctx).await? { return Ok(()) }
    sql("UPDATE presentation_items SET title = ? WHERE id = ?", vec![json!(title), json!(item_id)]).await;
    Ok(())
}

async fn set_item_note(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, note) = (id(a, "itemId")?, text_given(a, "note", 200)?);
    require(ctx, "ManagePresentations")?;
    if !require_item(&item_id, ctx).await? { return Ok(()) }
    sql("UPDATE presentation_items SET note = ? WHERE id = ?", vec![json!(note), json!(item_id)]).await;
    Ok(())
}

/// The arrangement a song item shows; null is the song's default.
async fn set_item_arrangement(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, wanted) = (id(a, "itemId")?, id_or_null(a, "arrangementId")?);
    require(ctx, "ManagePresentations")?;
    let Some(item) = first(sql("SELECT source_id, type FROM presentation_items WHERE id = ?", vec![json!(item_id)]).await) else { return Ok(()) };
    require_item(&item_id, ctx).await?;
    if item[1].as_str() != Some("song") { return Err("not-a-song".into()) }
    let own = match &wanted {
        Some(arr) => first(sql("SELECT id FROM song_arrangements WHERE id = ? AND song_id = ?", vec![json!(arr), item[0].clone()]).await).map(|r| r[0].clone()),
        None => None,
    };
    if wanted.is_some() && own.is_none() { return Err("not-found".into()) }
    sql("UPDATE presentation_items SET arrangement_id = ? WHERE id = ?", vec![own.unwrap_or(Value::Null), json!(item_id)]).await;
    Ok(())
}

/// The overlay an item carries; null for none.
async fn set_item_overlay(a: &Obj, ctx: &Ctx) -> R<()> {
    let (item_id, overlay) = (id(a, "itemId")?, id_or_null(a, "overlayId")?);
    require(ctx, "ManagePresentations")?;
    require(ctx, "ViewOverlays")?;
    if !require_item(&item_id, ctx).await? { return Ok(()) }
    if let Some(o) = &overlay {
        if !found("SELECT id FROM overlays WHERE id = ?", vec![json!(o)]).await { return Err("not-found".into()) }
    }
    sql("UPDATE presentation_items SET overlay_id = ? WHERE id = ?", vec![json!(overlay), json!(item_id)]).await;
    Ok(())
}

/// To the trash (`at`) or back from it; only a presentation, never a template.
async fn set_deleted(a: &Obj, ctx: &Ctx, trash: bool) -> R<()> {
    trash_or_restore(a, ctx, trash, false).await
}

/// `setDeletedAt` behind the arguments of trash and restore: a presentation's (`ManagePresentations`) or a template's.
pub async fn trash_or_restore(a: &Obj, ctx: &Ctx, trash: bool, template: bool) -> R<()> {
    let pid = id(a, "id")?;
    let at = if trash { json!(safe_int(a, "at")?) } else { Value::Null };
    require(ctx, if template { "ManageTemplates" } else { "ManagePresentations" })?;
    sql("UPDATE presentations SET deleted_at = ? WHERE id = ? AND is_template = ?", vec![at, json!(pid), json!(template as i64)]).await;
    Ok(())
}

/// Deleted for good, with its items: only from the trash.
async fn purge_presentation(a: &Obj, ctx: &Ctx) -> R<()> {
    purge(a, ctx, false).await
}

/// `purgeRows` behind purge's arguments: a trashed presentation or template and its items.
pub async fn purge(a: &Obj, ctx: &Ctx, template: bool) -> R<()> {
    let pid = id(a, "id")?;
    require(ctx, if template { "ManageTemplates" } else { "ManagePresentations" })?;
    let Some(p) = first(sql("SELECT deleted_at FROM presentations WHERE id = ? AND is_template = ?", vec![json!(pid), json!(template as i64)]).await) else { return Ok(()) };
    if p[0].is_null() { return Err("not-in-trash".into()) }
    sql("DELETE FROM presentation_items WHERE presentation_id = ?", vec![json!(pid)]).await;
    sql("DELETE FROM presentations WHERE id = ?", vec![json!(pid)]).await;
    Ok(())
}
