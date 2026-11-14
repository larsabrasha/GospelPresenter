// packages/core/src/mutators/themes.ts: themes of the organisation's own, and its default theme.
use super::*;
use crate::theme_def::definition;

const THEMES: i64 = 50;
const DEFAULT_THEME_SETTING: &str = "defaultThemeId";
/// The built-in themes: the product's, nobody changes or deletes them.
const BUILT_IN: [&str; 2] = ["classic", "light"];

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "createTheme" => create(a, ctx).await,
        "updateTheme" => update(a, ctx).await,
        "deleteTheme" => delete(a, ctx).await,
        "setDefaultTheme" => set_default(a, ctx).await,
        _ => return None,
    })
}

/// `requireTheme`: a theme the organisation can use, built in or its own.
pub async fn require_theme(theme_id: &str) -> R<()> {
    if BUILT_IN.contains(&theme_id) || found("SELECT id FROM themes WHERE id = ?", vec![json!(theme_id)]).await { Ok(()) } else { Err("theme-not-found".into()) }
}

fn require_own(theme_id: &str) -> R<()> { if BUILT_IN.contains(&theme_id) { Err("forbidden".into()) } else { Ok(()) } }

async fn create(a: &Obj, ctx: &Ctx) -> R<()> {
    let (tid, name, (def, blobs), at) = (id(a, "id")?, trimmed(a, "name", 1, 100)?, definition(a.get("definition"))?, safe_int(a, "at")?);
    require(ctx, "ManageThemes")?;
    require_own(&tid)?;
    if found("SELECT id FROM themes WHERE id = ?", vec![json!(tid)]).await { return Ok(()) }
    limit(int_of(&first(sql("SELECT count(*) FROM themes", vec![]).await).unwrap()[0]) >= THEMES)?;
    require_blobs(&blobs).await?;
    sql("INSERT INTO themes (id, name, definition, sort, updated_at) VALUES (?, ?, ?, ?, ?)", vec![json!(tid), json!(name), json!(def.stringify()), json!(at), json!(at)]).await;
    Ok(())
}

async fn update(a: &Obj, ctx: &Ctx) -> R<()> {
    let tid = id(a, "id")?;
    let name = if a.contains_key("name") { Some(trimmed(a, "name", 1, 100)?) } else { None };
    let def = if a.contains_key("definition") { Some(definition(a.get("definition"))?) } else { None };
    let at = safe_int(a, "at")?;
    require(ctx, "ManageThemes")?;
    require_own(&tid)?;
    if let Some((_, blobs)) = &def { require_blobs(blobs).await? }
    let mut set: Vec<(&str, Value)> = vec![("updated_at", json!(at))];
    if let Some(n) = name { set.push(("name", json!(n))) }
    if let Some((d, _)) = def { set.push(("definition", json!(d.stringify()))) }
    update_set("themes", set, &tid).await;
    Ok(())
}

/// For good: what showed it follows the default again, and a default that was it is cleared.
async fn delete(a: &Obj, ctx: &Ctx) -> R<()> {
    let tid = id(a, "id")?;
    require(ctx, "ManageThemes")?;
    require_own(&tid)?;
    sql("UPDATE presentations SET theme_id = NULL WHERE theme_id = ?", vec![json!(tid)]).await;
    let setting = first(sql("SELECT value FROM org_settings WHERE id = ?", vec![json!(DEFAULT_THEME_SETTING)]).await);
    if setting.is_some_and(|s| s[0].as_str() == Some(tid.as_str())) {
        sql("DELETE FROM org_settings WHERE id = ?", vec![json!(DEFAULT_THEME_SETTING)]).await;
    }
    sql("DELETE FROM themes WHERE id = ?", vec![json!(tid)]).await;
    Ok(())
}

async fn set_default(a: &Obj, ctx: &Ctx) -> R<()> {
    let tid = id(a, "themeId")?;
    require(ctx, "ManageThemes")?;
    require_theme(&tid).await?;
    set_setting(DEFAULT_THEME_SETTING, &tid).await;
    Ok(())
}

/// An organisation setting, made or changed (`onConflictDoUpdate`).
pub async fn set_setting(key: &str, value: &str) {
    sql("INSERT INTO org_settings (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value", vec![json!(key), json!(value)]).await;
}
