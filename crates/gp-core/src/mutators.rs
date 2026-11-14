// packages/core/src/mutators: every mutator, one module per file of it, each with its own dispatcher; what they share
// is base.ts's and permissions.ts's (the caller, the permission policy, the limits).
use crate::args::*;
use crate::bridge::{now, sql, Rows};
use serde_json::{json, Value};

pub mod presentations;

/// `MutatorCtx`: who calls, with which role, and the server's clock when it runs a push (absent on clients).
pub struct Ctx { pub user_id: String, pub role: String, pub now: Option<f64> }

const EVERYONE: [&str; 15] = ["ViewPresentations", "ManagePresentations", "ViewTemplates", "ViewSongs", "ManageSongs", "ViewBibles", "ViewThemes",
    "ViewImages", "ManageImages", "ViewAudios", "ManageAudios", "ViewVideos", "ManageVideos", "ViewOverlays", "ManageOverlays"];
const ADMIN: [&str; 9] = ["ManageTemplates", "ManageBibles", "ManageThemes", "ViewUsers", "ManageUsers", "ManageRemoteDisplays",
    "ManageOrganizationSettings", "ViewCcliReport", "ManageCcliReport"];

/// `can` (permissions.ts): what a role may do; an unknown role may do nothing.
pub fn can(role: &str, permission: &str) -> bool {
    let admin = || EVERYONE.contains(&permission) || ADMIN.contains(&permission);
    match role {
        "user" => EVERYONE.contains(&permission),
        "admin" => admin(),
        "superAdmin" => admin() || permission == "ManageOrganizations",
        _ => false,
    }
}

/// `requirePermission`.
pub fn require(ctx: &Ctx, permission: &str) -> R<()> { if can(&ctx.role, permission) { Ok(()) } else { Err("forbidden".into()) } }

/// `limit`: refused when `reached`.
pub fn limit(reached: bool) -> R<()> { if reached { Err("limit".into()) } else { Ok(()) } }

/// `changedAt`: the server's clock when it runs a push, else this device's.
pub fn changed_at(ctx: &Ctx) -> Value {
    let t = ctx.now.unwrap_or_else(now);
    if t.fract() == 0.0 { json!(t as i64) } else { json!(t) }
}

pub fn int_of(v: &Value) -> i64 { v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).unwrap_or(0) }
pub fn first(rows: Rows) -> Option<Vec<Value>> { rows.into_iter().next() }
pub fn s(v: &Value) -> String { v.as_str().unwrap_or("").to_string() }

/// The first column of `sql`'s rows, as strings.
pub async fn ids_of(q: &str, params: Vec<Value>) -> Vec<String> { sql(q, params).await.into_iter().map(|r| s(&r[0])).collect() }

/// `UPDATE table SET … WHERE id = ?` of the fields given; nothing when none is.
pub async fn update_set(table: &str, set: Vec<(&str, Value)>, row: &str) {
    if set.is_empty() { return }
    let cols: Vec<String> = set.iter().map(|(c, _)| format!("{c} = ?")).collect();
    let mut params: Vec<Value> = set.into_iter().map(|(_, v)| v).collect();
    params.push(json!(row));
    sql(&format!("UPDATE {table} SET {} WHERE id = ?", cols.join(", ")), params).await;
}

/// `z.number().int().min(0)`: an index.
pub fn index(o: &Obj, k: &str) -> R<usize> { int(o, k, 0, 2i64.pow(53) - 1).map(|i| i as usize) }

/// `parsePartIds`: an arrangement's part ids; anything else reads as empty.
pub fn parse_part_ids(text: &str) -> Vec<String> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

/// Whether `sql` finds a row.
pub async fn found(q: &str, params: Vec<Value>) -> bool { !sql(q, params).await.is_empty() }

/// `requireBlobs`: every blob of `hashes` known where this runs, else `media-missing`.
pub async fn require_blobs(hashes: &[String]) -> R<()> {
    let mut seen: Vec<&String> = Vec::new();
    for h in hashes {
        if seen.contains(&h) { continue }
        seen.push(h);
        if !found("SELECT hash FROM media_blobs WHERE hash = ?", vec![json!(h)]).await { return Err("media-missing".into()) }
    }
    Ok(())
}

/// A command: the schema's migration, a view, or a mutator, by name.
pub async fn run(input: Value) -> R<Value> {
    let ctx = Ctx {
        user_id: input["ctx"]["userId"].as_str().unwrap_or("").into(),
        role: input["ctx"]["role"].as_str().unwrap_or("").into(),
        now: input["ctx"]["now"].as_f64(),
    };
    let name = input["name"].as_str().unwrap_or("");
    match name {
        "migrateOrgSchema" => return crate::schema::migrate().await,
        "seedLabels" => return crate::schema::seed_labels().await,
        _ => {}
    }
    let a = obj(&input["args"])?;
    if let Some(view) = crate::views::run(name, a).await { return view; }
    let done = match presentations::run(name, a, &ctx).await {
        Some(r) => r,
        None => return Err("unknown-mutator".into()),
    };
    done.map(|()| Value::Null)
}
