// packages/core/src/mutators/templates.ts: templates, a presentation saved as one, and a presentation made from one.
use super::*;
use super::presentations::{purge, trash_or_restore};

const ITEMS_PER_PRESENTATION: usize = 100;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createTemplate" => create(a, ctx).await,
        "updateTemplate" => update(a, ctx).await,
        "saveAsTemplate" => save_as(a, ctx).await,
        "createFromTemplate" => create_from(a, ctx).await,
        "trashTemplate" => trash_or_restore(a, ctx, true, true).await,
        "restoreTemplate" => trash_or_restore(a, ctx, false, true).await,
        "purgeTemplate" => purge(a, ctx, true).await,
        _ => return None,
    })
}

/// `weekday`: 0 = Sunday … 6 = Saturday, or null.
fn opt_weekday(o: &Obj, k: &str) -> R<Option<i64>> {
    match o.get(k) { None | Some(Value::Null) => Ok(None), Some(_) => int(o, k, 0, 6).map(Some) }
}

/// `copiedItems`: the items to copy, each with the id its copy gets.
fn copied(o: &Obj) -> R<Vec<(String, String)>> {
    match o.get("items") {
        Some(Value::Array(xs)) if xs.len() <= ITEMS_PER_PRESENTATION => xs.iter().map(|x| { let x = obj(x)?; Ok((id(x, "from")?, id(x, "id")?)) }).collect(),
        _ => Err("invalid-args".into()),
    }
}

/// `copyItems`: the named items of one presentation or template into another, in their order there; an item
/// removed meanwhile is left out.
async fn copy_items(from: &str, to: &str, copies: &[(String, String)]) {
    let mut sort = 0;
    for item in ids_of("SELECT id FROM presentation_items WHERE presentation_id = ? ORDER BY sort ASC, id ASC", vec![json!(from)]).await {
        let Some((_, new_id)) = copies.iter().rfind(|(f, _)| *f == item) else { continue }; // the last of a repeat, as a Map keeps it
        sql("INSERT INTO presentation_items (id, presentation_id, type, title, source_id, sort, arrangement_id, content, overlay_id, note)
             SELECT ?, ?, type, title, source_id, ?, arrangement_id, content, overlay_id, note FROM presentation_items WHERE id = ?",
            vec![json!(new_id), json!(to), json!(sort), json!(item)]).await;
        sort += 1;
    }
}

async fn exists(pid: &str) -> bool { found("SELECT id FROM presentations WHERE id = ?", vec![json!(pid)]).await }

async fn create(a: &Obj, ctx: &Ctx) -> R<()> {
    let (tid, name) = (id(a, "id")?, name(a, "name")?);
    let (weekday, time, location) = (opt_weekday(a, "weekday")?, opt_time(a, "time")?, opt_text(a, "location", 100)?);
    require(ctx, "ManageTemplates")?;
    sql("INSERT INTO presentations (id, name, is_template, weekday, time, location, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        vec![json!(tid), json!(name), json!(weekday), json!(time), json!(location), changed_at(ctx)]).await;
    Ok(())
}

async fn update(a: &Obj, ctx: &Ctx) -> R<()> {
    let tid = id(a, "id")?;
    let name = opt_name(a, "name")?;
    let weekday = field(a, "weekday", opt_weekday)?;
    let time = field(a, "time", opt_time)?;
    let location = field(a, "location", |o, k| opt_text(o, k, 100))?;
    require(ctx, "ManageTemplates")?;
    let mut set: Vec<(&str, Value)> = Vec::new();
    if let Some(n) = name { set.push(("name", json!(n))) }
    if let Some(w) = weekday { set.push(("weekday", json!(w))) }
    for (col, v) in [("time", time), ("location", location)] {
        if let Some(v) = v { set.push((col, json!(v))) }
    }
    if set.is_empty() { return Ok(()) }
    set.push(("updated_at", changed_at(ctx)));
    let cols: Vec<String> = set.iter().map(|(c, _)| format!("{c} = ?")).collect();
    let mut params: Vec<Value> = set.into_iter().map(|(_, v)| v).collect();
    params.push(json!(tid));
    sql(&format!("UPDATE presentations SET {} WHERE id = ? AND is_template = 1", cols.join(", ")), params).await;
    Ok(())
}

/// "Spara som mall": a new template with the presentation's items and theme, and no weekly slot.
async fn save_as(a: &Obj, ctx: &Ctx) -> R<()> {
    let (tid, pid, name, copies) = (id(a, "id")?, id(a, "presentationId")?, name(a, "name")?, copied(a)?);
    require(ctx, "ManageTemplates")?;
    if exists(&tid).await { return Ok(()) }
    let source = first(sql("SELECT theme_id FROM presentations WHERE id = ?", vec![json!(pid)]).await).ok_or("not-found")?;
    sql("INSERT INTO presentations (id, name, is_template, theme_id, updated_at) VALUES (?, ?, 1, ?, ?)",
        vec![json!(tid), json!(name), source[0].clone(), changed_at(ctx)]).await;
    copy_items(&pid, &tid, &copies).await;
    Ok(())
}

/// A new presentation from a template: its items, in order, and its theme. A template in the trash cannot be used.
async fn create_from(a: &Obj, ctx: &Ctx) -> R<()> {
    let (pid, tid, name) = (id(a, "id")?, id(a, "templateId")?, name(a, "name")?);
    let (date, time) = (opt_date(a, "eventDate")?, opt_time(a, "time")?);
    let (location, description) = (opt_text(a, "location", 100)?, opt_text(a, "description", 5000)?);
    let (copies, at) = (copied(a)?, safe_int(a, "at")?);
    require(ctx, "ManagePresentations")?;
    require(ctx, "ViewTemplates")?;
    if exists(&pid).await { return Ok(()) }
    let template = first(sql("SELECT theme_id, deleted_at FROM presentations WHERE id = ? AND is_template = 1", vec![json!(tid)]).await);
    let Some(template) = template.filter(|t| t[1].is_null()) else { return Err("not-found".into()) };
    sql("INSERT INTO presentations (id, name, event_date, time, location, description, theme_id, is_template, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
        vec![json!(pid), json!(name), json!(date), json!(time), json!(location), json!(description), template[0].clone(), changed_at(ctx)]).await;
    copy_items(&tid, &pid, &copies).await;
    sql("UPDATE presentations SET last_used_at = ? WHERE id = ?", vec![json!(at), json!(tid)]).await;
    Ok(())
}
