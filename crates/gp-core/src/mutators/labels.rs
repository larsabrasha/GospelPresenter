// packages/core/src/mutators/labels.ts: part labels, found by their text, case and spacing aside.
use super::*;
use crate::schema::label_defaults;

const LABEL_LIMIT: usize = 200;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createLabel" => create_label(a, ctx).await,
        "updateLabel" => update_label(a, ctx).await,
        "deleteLabel" => delete_label(a, ctx).await,
        "moveLabel" => move_label(a, ctx).await,
        _ => return None,
    })
}

/// The labels, as `allLabels`: (id, text) in their order.
async fn all_labels() -> Vec<(String, String)> {
    sql("SELECT id, text FROM labels ORDER BY sort ASC, text ASC", vec![]).await.into_iter().map(|r| (s(&r[0]), s(&r[1]))).collect()
}

fn label_id(text: &str) -> String { format!("label:{}", label_key(text)) }

/// `freeLabelId`: `labelId(text)`, or with a number when a renamed label holds that.
fn free_label_id(text: &str, all: &[(String, String)]) -> String {
    let first = label_id(text);
    let mut lid = first.clone();
    let mut n = 2;
    while all.iter().any(|(id, _)| *id == lid) {
        lid = format!("{first}:{n}");
        n += 1;
    }
    lid
}

async fn next_sort() -> i64 {
    let m = first(sql("SELECT max(sort) FROM labels", vec![]).await).unwrap();
    if m[0].is_null() { 0 } else { int_of(&m[0]) + 1 }
}

/// `ensureLabel`: the label with `text`, made when there is none, in the default label's colour or grey.
pub async fn ensure_label(text: Option<&str>) -> Option<String> {
    let text = text.filter(|t| !js_trim(t).is_empty())?;
    let key = label_key(text);
    if let Some(d) = first(sql("SELECT id, text FROM labels WHERE id = ?", vec![json!(label_id(text))]).await) {
        if label_key(&s(&d[1])) == key { return Some(s(&d[0])) }
    }
    let all = all_labels().await;
    if let Some((id, _)) = all.iter().find(|(_, t)| label_key(t) == key) { return Some(id.clone()) }
    let lid = free_label_id(text, &all);
    let sort = next_sort().await;
    sql("INSERT INTO labels (id, text, color, sort) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        vec![json!(lid), json!(js_trim(text)), json!(label_defaults(text).0), json!(sort)]).await;
    Some(lid)
}

fn refuse_taken(all: &[(String, String)], text: &str, own: Option<&str>) -> R<()> {
    if all.iter().any(|(id, t)| Some(id.as_str()) != own && label_key(t) == label_key(text)) { Err("label-exists".into()) } else { Ok(()) }
}

/// `#RRGGBB`, lower-cased.
fn color(o: &Obj, k: &str) -> R<String> {
    match o.get(k) {
        Some(Value::String(c)) if c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit()) => Ok(c.to_ascii_lowercase()),
        _ => Err("invalid-args".into()),
    }
}

async fn create_label(a: &Obj, ctx: &Ctx) -> R<()> {
    let (text, color) = (trimmed(a, "text", 1, 50)?, color(a, "color")?);
    require(ctx, "ManageSongs")?;
    let all = all_labels().await;
    refuse_taken(&all, &text, None)?;
    limit(all.len() >= LABEL_LIMIT)?;
    let lid = free_label_id(&text, &all);
    let sort = next_sort().await;
    sql("INSERT INTO labels (id, text, color, sort) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", vec![json!(lid), json!(text), json!(color), json!(sort)]).await;
    Ok(())
}

async fn update_label(a: &Obj, ctx: &Ctx) -> R<()> {
    let lid = id(a, "id")?;
    let text = if a.contains_key("text") { Some(trimmed(a, "text", 1, 50)?) } else { None };
    let color = if a.contains_key("color") { Some(color(a, "color")?) } else { None };
    require(ctx, "ManageSongs")?;
    let all = all_labels().await;
    if !all.iter().any(|(id, _)| *id == lid) { return Ok(()) }
    if let Some(t) = &text { refuse_taken(&all, t, Some(&lid))? }
    let mut set: Vec<(&str, Value)> = Vec::new();
    if let Some(t) = text { set.push(("text", json!(t))) }
    if let Some(c) = color { set.push(("color", json!(c))) }
    update_set("labels", set, &lid).await;
    Ok(())
}

/// Writes 0..n-1 as the labels' sort, touching only rows that change.
async fn renumber(order: &[String]) {
    for (i, lid) in order.iter().enumerate() {
        sql("UPDATE labels SET sort = ? WHERE id = ? AND sort <> ?", vec![json!(i), json!(lid), json!(i)]).await;
    }
}

async fn delete_label(a: &Obj, ctx: &Ctx) -> R<()> {
    let lid = id(a, "id")?;
    require(ctx, "ManageSongs")?;
    sql("UPDATE song_parts SET label_id = NULL WHERE label_id = ?", vec![json!(lid)]).await;
    sql("DELETE FROM labels WHERE id = ?", vec![json!(lid)]).await;
    let order: Vec<String> = all_labels().await.into_iter().map(|(id, _)| id).collect();
    renumber(&order).await;
    Ok(())
}

async fn move_label(a: &Obj, ctx: &Ctx) -> R<()> {
    let (lid, to) = (id(a, "id")?, index(a, "toIndex")?);
    require(ctx, "ManageSongs")?;
    let order: Vec<String> = all_labels().await.into_iter().map(|(id, _)| id).collect();
    if !order.contains(&lid) { return Ok(()) }
    let mut rest: Vec<String> = order.into_iter().filter(|x| *x != lid).collect();
    rest.insert(to.min(rest.len()), lid);
    renumber(&rest).await;
    Ok(())
}
