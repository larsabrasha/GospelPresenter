// packages/core/src/mutators/displays.ts: the organisation's outputs, each with a code to open it by.
use super::*;

const MAX_DISPLAYS: i64 = 50;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createDisplay" => create_display(a, ctx).await,
        "newDisplayCode" => new_display_code(a, ctx).await,
        "deleteDisplay" => delete_display(a, ctx).await,
        _ => return None,
    })
}

/// `DISPLAY_CODE`: seven of the letters and digits that are not easily confused.
fn display_code(o: &Obj, k: &str) -> R<String> {
    match o.get(k) {
        Some(Value::String(c)) if c.len() == 7 && c.bytes().all(|b| b"abcdefghjkmnpqrstuvwxyz23456789".contains(&b)) => Ok(c.clone()),
        _ => Err("invalid-args".into()),
    }
}

async fn require_free_code(code: &str, except: Option<&str>) -> R<()> {
    match first(sql("SELECT id FROM displays WHERE code = ?", vec![json!(code)]).await) {
        Some(t) if t[0].as_str() != except => Err("code-taken".into()),
        _ => Ok(()),
    }
}

async fn create_display(a: &Obj, ctx: &Ctx) -> R<()> {
    let (did, name, code, kind) = (id(a, "id")?, name(a, "name")?, display_code(a, "code")?, one_of(a, "kind", &["public", "screen"])?);
    require(ctx, "ManageRemoteDisplays")?;
    if found("SELECT id FROM displays WHERE id = ?", vec![json!(did)]).await { return Ok(()) }
    limit(int_of(&first(sql("SELECT count(*) FROM displays", vec![]).await).unwrap()[0]) >= MAX_DISPLAYS)?;
    require_free_code(&code, None).await?;
    sql("INSERT INTO displays (id, name, code, kind, created_at) VALUES (?, ?, ?, ?, ?)", vec![json!(did), json!(name), json!(code), json!(kind), changed_at(ctx)]).await;
    Ok(())
}

async fn new_display_code(a: &Obj, ctx: &Ctx) -> R<()> {
    let (did, code) = (id(a, "id")?, display_code(a, "code")?);
    require(ctx, "ManageRemoteDisplays")?;
    require_free_code(&code, Some(&did)).await?;
    sql("UPDATE displays SET code = ? WHERE id = ?", vec![json!(code), json!(did)]).await;
    Ok(())
}

async fn delete_display(a: &Obj, ctx: &Ctx) -> R<()> {
    let did = id(a, "id")?;
    require(ctx, "ManageRemoteDisplays")?;
    sql("DELETE FROM displays WHERE id = ?", vec![json!(did)]).await;
    Ok(())
}
