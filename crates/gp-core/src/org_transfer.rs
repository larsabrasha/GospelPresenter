// An organisation moved between servers (the web's media/orgExport.ts and media/legacyImport.ts, docs/import-from-1x.md):
// what an export zip holds and in what order, and what an import reads from one, checked as the web checks it. The
// shell moves the bytes: it downloads the files, writes and reads the zip, and sends the rows and users to the server.
use crate::args::*;
use serde_json::{json, Value};

/// This build's export format, and those an import reads (`LEGACY_FORMAT`, `LEGACY_FORMATS_READ`).
const FORMAT: i64 = 8;
const READ: [i64; 8] = [1, 2, 3, 4, 5, 6, 7, 8];

/// The tables an import writes, parents first (`LEGACY_TABLES`), and those only format 8 has (`TABLES_SINCE_8`).
const TABLES: [&str; 18] = [
    "labels", "org_settings", "themes", "bibles", "images", "audios", "videos", "overlays", "displays", "songs", "song_parts",
    "song_arrangements", "song_versions", "song_materials", "presentations", "custom_slides", "presentation_items", "ccli_entries",
];
const SINCE_8: [&str; 3] = ["themes", "videos", "song_materials"];

/// `name` made fit for a file's name (orgExport.ts's `fileSafe`): runs of anything but letters and digits a hyphen.
fn file_safe(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_alphanumeric() { out.push(c) } else if !out.ends_with('-') { out.push('-') }
    }
    let t = out.trim_matches('-').to_string();
    if t.is_empty() { "organisation".into() } else { t }
}

/// The Bible texts an export holds, each with the row that names it: one per text, as orgExport.ts's Map, as two
/// translations may share one (the same text under two abbreviations).
fn bible_texts(rows: &Value) -> Vec<(String, String)> {
    let mut seen = std::collections::HashSet::new();
    rows["bibles"].as_array().map(Vec::as_slice).unwrap_or_default().iter()
        .filter_map(|b| Some((b["content_hash"].as_str()?.to_string(), format!("bibles {}", b["id"].as_str().unwrap_or("")))))
        .filter(|(h, _)| seen.insert(h.clone())).collect()
}

/// `exportPlanView` {orgName, today, now, rows (exportRowsView's JSON text), users (`GET /api/users`)}: the export
/// zip's entries in order (orgExport.ts's `exportOrg`): the manifest and the users (those with an address, as the
/// import invites them) as JSON, a file of rows per table, then the files to fetch (`path`) under their names, sorted;
/// the zip's `name`; or refused `rows` with the first row the server would refuse (`problem`).
pub fn export_plan(a: &Obj) -> R<Value> {
    let rows_text = a.get("rows").and_then(Value::as_str).ok_or("invalid-args")?;
    let rows_arg = json!({ "rows": rows_text });
    let rows_obj = rows_arg.as_object().unwrap();
    if let Value::String(p) = crate::legacy::problem_view(rows_obj)? { return Ok(json!({ "problem": p })) }
    let rows: Value = serde_json::from_str(rows_text).map_err(|_| "invalid-args")?;
    let blobs = crate::legacy::blobs_view(rows_obj)?;
    let users: Vec<Value> = a.get("users").and_then(Value::as_array).cloned().unwrap_or_default().into_iter()
        .filter(|u| u["email"].as_str().is_some_and(|e| !e.is_empty()))
        .map(|u| json!({ "name": u["name"], "email": u["email"], "role": u["role"], "google": [] })).collect();
    let mut named: Vec<(String, String)> = blobs["named"].as_array().unwrap().iter().filter_map(|n| Some((n[0].as_str()?.to_string(), n[1].as_str()?.to_string()))).collect();
    let mut seen = std::collections::HashSet::new();
    named.retain(|(h, _)| seen.insert(h.clone()));
    let texts = bible_texts(&rows);
    let mut files: Vec<Value> = named.iter().map(|(h, row)| json!({ "name": format!("blobs/{h}"), "path": format!("/api/media/{h}"), "row": row }))
        .chain(texts.iter().map(|(h, row)| json!({ "name": format!("bibles/{h}.json"), "path": format!("/api/bibles/{h}"), "row": row }))).collect();
    files.sort_by(|x, y| x["name"].as_str().unwrap_or("").cmp(y["name"].as_str().unwrap_or("")));
    let mut counts = serde_json::Map::new();
    for t in TABLES { counts.insert(t.into(), json!(rows[t].as_array().map_or(0, |r| r.len()))); }
    counts.insert("users".into(), json!(users.len()));
    counts.insert("blobs".into(), json!(named.len()));
    counts.insert("bibleTexts".into(), json!(texts.len()));
    let org = a.get("orgName").and_then(Value::as_str).unwrap_or("");
    let manifest = json!({ "format": FORMAT, "orgName": org, "exportedAt": a.get("now").and_then(Value::as_i64).unwrap_or(0), "counts": counts });
    let mut entries = vec![json!({ "name": "manifest.json", "text": manifest.to_string() }), json!({ "name": "users.json", "text": Value::Array(users).to_string() })];
    entries.extend(TABLES.iter().map(|t| json!({ "name": format!("rows/{t}.json"), "text": rows[*t].to_string() })));
    let today = a.get("today").and_then(Value::as_str).unwrap_or("");
    Ok(json!({ "problem": null, "entries": entries, "files": files, "name": format!("gospel-presenter-{}-{today}.zip", file_safe(org)) }))
}

/// `importManifestView` {text}: an export zip's manifest as the import reads it (`legacyManifestSchema`,
/// `LEGACY_FORMATS_READ`): the manifest and the row files to read for its format (an older one has the tables of its
/// own), or refused `not-export` (not a manifest) or `format` (one this build does not read).
pub fn import_manifest(a: &Obj) -> R<Value> {
    let m: Value = a.get("text").and_then(Value::as_str).and_then(|t| serde_json::from_str(t).ok()).ok_or("not-export")?;
    let format = m["format"].as_f64().filter(|f| f.fract() == 0.0).ok_or("not-export")? as i64;
    let ok = m["orgName"].as_str().is_some_and(|n| n.chars().count() <= 200) && m["exportedAt"].as_f64().is_some_and(|f| f.fract() == 0.0)
        && m["counts"].as_object().is_some_and(|c| c.values().all(|v| v.as_f64().is_some_and(|n| n >= 0.0 && n.fract() == 0.0)));
    if !ok { return Err("not-export".into()) }
    if !READ.contains(&format) { return Err("format".into()) }
    let own: Vec<&str> = TABLES.iter().copied().filter(|t| format >= 8 || !SINCE_8.contains(t)).collect();
    let mut tables: Vec<&str> = if format >= 5 { own } else { own.into_iter().filter(|t| *t != "custom_slides").collect() };
    if format == 3 { tables.push("slide_decks") }
    Ok(json!({ "manifest": m, "rows": tables.iter().map(|t| json!({ "table": t, "name": format!("rows/{t}.json") })).collect::<Vec<_>>() }))
}

/// `importPlanView` {format, rows ({table: rows}), users (text)}: what goes to the server: the `rows` brought to this
/// format as JSON text (`legacyUpgradeView`), the `users` as the import invites them (each a name, an address, user
/// or admin, at most 1 000), and the blobs that are `videos` (they go up in parts); refused `not-export` for users
/// that do not read, `invalid-rows` for rows.
pub fn import_plan(a: &Obj) -> R<Value> {
    let format = a.get("format").and_then(Value::as_f64).ok_or("invalid-args")?;
    let rows = a.get("rows").filter(|r| r.is_object()).ok_or("invalid-args")?;
    let upgraded = crate::legacy::upgrade_view(json!({ "format": format, "rows": rows.to_string() }).as_object().unwrap())?;
    let text = upgraded.as_str().ok_or("invalid-rows")?.to_string();
    let users: Value = a.get("users").and_then(Value::as_str).and_then(|t| serde_json::from_str(t).ok()).ok_or("not-export")?;
    let list = users.as_array().filter(|u| u.len() <= 1000).ok_or("not-export")?;
    // emailSchema: trimmed, lowercased, at most 320 characters, /^[^@\s]+@[^@\s]+\.[^@\s]+$/ (one @, and a dot in the
    // domain with something on each side of it).
    let email = |e: &str| -> Option<String> {
        let e = e.trim().to_lowercase();
        let (l, d) = e.split_once('@')?;
        let plain = |s: &str| !s.is_empty() && !s.contains('@') && !s.contains(char::is_whitespace);
        let dotted = d.char_indices().any(|(i, c)| c == '.' && i > 0 && i + 1 < d.len());
        (e.chars().count() <= 320 && plain(l) && plain(d) && dotted).then_some(e.clone())
    };
    let mut kept = Vec::new();
    for u in list {
        let name = u["name"].as_str().map(str::trim).unwrap_or("");
        let google_ok = u["google"].as_array().is_some_and(|g| g.len() <= 10 && g.iter().all(|s| s.as_str().is_some_and(|s| (1..=255).contains(&s.chars().count()))));
        let role = u["role"].as_str().unwrap_or("");
        let Some(address) = u["email"].as_str().and_then(email) else { return Err("not-export".into()) };
        if name.is_empty() || name.chars().count() > 200 || !["user", "admin"].contains(&role) || !google_ok {
            return Err("not-export".into());
        }
        // As the web sends legacyUsersSchema's output: the name trimmed, the address trimmed and lowercased.
        kept.push(json!({ "name": name, "email": address, "role": role, "google": u["google"] }));
    }
    let videos = crate::legacy::blobs_view(json!({ "rows": text }).as_object().unwrap())?["videos"].clone();
    Ok(json!({ "rows": text, "users": kept, "videos": videos }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: Value) -> Obj { v.as_object().unwrap().clone() }
    fn empty_rows() -> String { let mut m = serde_json::Map::new(); for t in TABLES { m.insert(t.into(), json!([])); } Value::Object(m).to_string() }

    #[test]
    fn an_export_holds_the_manifest_users_and_a_file_of_rows_per_table() {
        let p = export_plan(&args(json!({ "orgName": "Ny Kyrka!", "today": "2026-11-21", "now": 5, "rows": empty_rows(),
            "users": [{ "name": "A", "email": "a@b.se", "role": "admin" }, { "name": "B", "email": null, "role": "user" }] }))).unwrap();

        let names: Vec<&str> = p["entries"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
        assert_eq!((names[0], names[1], names.len(), p["name"].clone()), ("manifest.json", "users.json", 20, json!("gospel-presenter-Ny-Kyrka-2026-11-21.zip")));
        assert_eq!(serde_json::from_str::<Value>(p["entries"][1]["text"].as_str().unwrap()).unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_manifest_of_a_format_not_read_is_refused() {
        assert_eq!(import_manifest(&args(json!({ "text": r#"{"format":99,"orgName":"x","exportedAt":1,"counts":{}}"# }))).unwrap_err(), "format");
        assert_eq!(import_manifest(&args(json!({ "text": "nonsense" }))).unwrap_err(), "not-export");
    }

    #[test]
    fn an_older_format_reads_its_own_tables() {
        let m = import_manifest(&args(json!({ "text": r#"{"format":3,"orgName":"x","exportedAt":1,"counts":{}}"# }))).unwrap();

        let tables: Vec<&str> = m["rows"].as_array().unwrap().iter().map(|r| r["table"].as_str().unwrap()).collect();
        assert!(tables.contains(&"slide_decks") && !tables.contains(&"custom_slides") && !tables.contains(&"themes"));
    }

    #[test]
    fn users_that_do_not_read_are_refused() {
        let rows: Value = serde_json::from_str(&empty_rows()).unwrap();

        let r = import_plan(&args(json!({ "format": 8, "rows": rows, "users": r#"[{"name":"","email":"a@b.se","role":"user","google":[]}]"# })));

        assert_eq!(r.unwrap_err(), "not-export");
    }

    #[test]
    fn users_go_to_the_server_trimmed_and_lowercased() {
        let rows: Value = serde_json::from_str(&empty_rows()).unwrap();

        let p = import_plan(&args(json!({ "format": 8, "rows": rows, "users": r#"[{"name":" Anna ","email":" Anna@Kyrkan.SE ","role":"user","google":[]}]"# }))).unwrap();

        assert_eq!((p["users"][0]["name"].clone(), p["users"][0]["email"].clone()), (json!("Anna"), json!("anna@kyrkan.se")));
    }

    #[test]
    fn an_address_with_two_ats_is_refused_as_the_web_refuses_it() {
        let rows: Value = serde_json::from_str(&empty_rows()).unwrap();

        let r = import_plan(&args(json!({ "format": 8, "rows": rows, "users": r#"[{"name":"A","email":"a@b@c.se","role":"user","google":[]}]"# })));

        assert_eq!(r.unwrap_err(), "not-export");
    }

    #[test]
    fn two_translations_sharing_a_text_give_one_file() {
        let rows = json!({ "bibles": [{ "id": "b1", "content_hash": "h" }, { "id": "b2", "content_hash": "h" }] });

        let texts = bible_texts(&rows);

        assert_eq!(texts, vec![("h".to_string(), "bibles b1".to_string())]);
    }
}
