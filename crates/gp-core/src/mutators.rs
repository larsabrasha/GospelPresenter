// packages/core/src/mutators: every mutator, one module per file of it, each with its own dispatcher; what they share
// is base.ts's and permissions.ts's (the caller, the permission policy, the limits).
use crate::args::*;
use crate::bridge::{now, sql, Rows};
use serde_json::{json, Value};

mod arrangements;
mod bibles_and_themes;
mod ccli;
mod custom_slides;
mod displays;
mod history;
mod labels;
mod media;
mod media_items;
mod org_settings;
mod overlays;
pub mod presentations;
mod probe;
mod song_import;
mod song_materials;
pub mod songs;
mod templates;
mod themes;
mod trash;

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

/// `rulesView`: what each role may do, and the limits the mutators hold to, for the shells to show only what will
/// be taken (a button hidden, a field's length): the core's own, so no shell keeps a copy that could drift.
pub fn rules() -> Value {
    let of = |role: &str| -> Vec<&str> { EVERYONE.iter().chain(ADMIN.iter()).chain(["ManageOrganizations"].iter()).copied().filter(|p| can(role, p)).collect() };
    json!({
        "permissions": { "user": of("user"), "admin": of("admin"), "superAdmin": of("superAdmin") },
        "limits": {
            "songs": songs::SONGS, "partsPerSong": songs::PARTS_PER_SONG, "arrangementsPerSong": songs::ARRANGEMENTS_PER_SONG,
            "itemsPerPresentation": presentations::ITEMS_PER_PRESENTATION, "versesPerItem": crate::bible::VERSES_PER_ITEM,
            "customSlides": custom_slides::SLIDES, "customElements": crate::pages::ELEMENTS, "customPages": crate::pages::PAGES,
            "customText": crate::pages::TEXT, "fileName": media::FILE_NAME,
        },
        // A field's rule as the mutators check it (docs/view-models.md): whether it may be left empty, and its most
        // characters, so a shell's Spara and its field's length are the core's, not a copy.
        "fields": {
            "presentationName": { "required": true, "max": crate::args::NAME },
            "itemTitle": { "required": true, "max": crate::args::NAME },
            "itemNote": { "required": false, "max": presentations::NOTE },
            "location": { "required": false, "max": presentations::LOCATION },
            "description": { "required": false, "max": presentations::DESCRIPTION },
        },
    })
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

/// A renamed thing of the library (a slideshow, a picture, a sound, a video): the items of `kind` it is, in presentations
/// and templates, take its new name, as a renamed song's do (Lars, 2026-11-17). An item of several pictures has a name
/// of its own (its pictures in `content`) and keeps it; a thing gone renames nothing.
pub async fn rename_items(table: &str, kind: &str, source_id: &str, name: &str) {
    if !found(&format!("SELECT id FROM {table} WHERE id = ?"), vec![json!(source_id)]).await { return }
    sql("UPDATE presentation_items SET title = ? WHERE type = ? AND source_id = ? AND content IS NULL AND title <> ?", vec![json!(name), json!(kind), json!(source_id), json!(name)]).await;
}

/// A change of a row whose every field keeps its own time (`{field}_at`, schema 27): the newest change of a field wins,
/// by the clocks of the devices that made them, not the last to reach the server (SYNC-R23, docs/assumptions.md).
/// Refused as `newer-change` when a field it changes was changed after `at`, so an edit made offline yesterday does not
/// undo one made online this morning, and its device is told; fields it does not change are another's to change.
/// Else each field is written with `at` as its time, and `updated_at` only moves forward. A row gone changes nothing.
pub async fn update_fields(table: &str, row: &str, fields: Vec<(&str, Value)>, at: i64) -> R<()> {
    if !fields.is_empty() {
        let times = fields.iter().map(|(f, _)| format!("{f}_at")).collect::<Vec<_>>().join(", ");
        let newer = first(sql(&format!("SELECT {times} FROM {table} WHERE id = ?"), vec![json!(row)]).await)
            .is_some_and(|r| r.iter().any(|t| t.as_f64().is_some_and(|t| t > at as f64)));
        if newer { return Err("newer-change".into()) }
    }
    let mut cols = vec!["updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END".to_string()];
    let mut params = vec![json!(at), json!(at)];
    for (f, v) in fields {
        cols.push(format!("{f} = ?, {f}_at = ?"));
        params.extend([v, json!(at)]);
    }
    params.push(json!(row));
    sql(&format!("UPDATE {table} SET {} WHERE id = ?", cols.join(", ")), params).await;
    Ok(())
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
    if let Some(done) = crate::sync::run(name, a, &ctx).await { return done; }
    mutate(name, a, &ctx).await.map(|()| Value::Null)
}

/// A mutator by name: done, or its refusal's code.
pub async fn mutate(name: &str, a: &Obj, ctx: &Ctx) -> R<()> {
    // Each file's dispatcher in turn: the first that knows the name runs it.
    macro_rules! dispatch { ($($file:ident),*) => { $( if let Some(done) = $file::run(name, a, ctx).await { return done } )* } }
    dispatch!(presentations, songs, arrangements, labels, song_materials, history, templates, custom_slides, themes, bibles_and_themes,
        overlays, displays, ccli, org_settings, trash, media, probe);
    Err("unknown-mutator".into())
}
