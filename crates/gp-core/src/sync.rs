// packages/sync/src/client/client.ts's SyncClient, what of it decides what the device's database holds: a change run
// at once and queued (`_mutation`), the queue to send, and the rebase of the queue onto the server's pages. The
// network, the socket, when to sync, retries, sign-in and the server's refusals stay in the shell. The shell runs
// `syncOpen` in the transaction of `migrateOrgSchema`, after it, and each of the others in one transaction of its
// own, rolled back when the core refuses.
use crate::args::*;
use crate::bridge::{sql, take_failure};
use crate::mutators::{first, int_of, mutate, s, Ctx};
use crate::sync_sql::{change_tracking_ddl, columns, undo_restore, undo_triggers, upsert, CHANGED_TABLES, CLIENT_SYNC_DDL, TABLES};
use serde_json::{json, Value};

/// Every mutator's version (`m()` in registry.ts gives each v 1).
const MUTATOR_VERSION: i64 = 1;
/// Most values bound in one statement of a pull.
const MAX_PARAMS: usize = 5000;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<Value>> {
    Some(match name {
        "syncOpen" => open(a).await,
        "syncMutate" => queue(a, ctx).await,
        "syncPending" => Ok(pending().await),
        "syncRebase" => rebase(a, ctx).await,
        _ => return None,
    })
}

/// The client's sync tables, its triggers and its record of changed tables; this device's id, kept from the first open.
/// In the shell's transaction, so the shell turns foreign keys on before it (SQLite ignores the PRAGMA inside one).
async fn open(a: &Obj) -> R<Value> {
    let client_id = a.get("clientId").and_then(Value::as_str).ok_or("invalid-args")?;
    let ddl = CLIENT_SYNC_DDL.iter().map(|s| s.to_string()).chain(undo_triggers()).chain(change_tracking_ddl());
    for s in ddl { sql(&s, vec![]).await; }
    sql("INSERT OR IGNORE INTO _sync_meta (one, client_id) VALUES (1, ?)", vec![json!(client_id)]).await;
    let id = first(sql("SELECT client_id FROM _sync_meta", vec![]).await).map(|r| r[0].clone()).unwrap_or(Value::Null);
    Ok(json!({ "clientId": id }))
}

/// The tables the open transaction wrote, forgotten before it commits.
async fn changed_tables() -> Vec<Value> {
    let tables: Vec<Value> = sql(&format!("SELECT tbl FROM {CHANGED_TABLES}"), vec![]).await.into_iter().map(|r| r[0].clone()).collect();
    if !tables.is_empty() { sql(&format!("DELETE FROM {CHANGED_TABLES}"), vec![]).await; }
    tables
}

/// A mutator by name, its arguments as the text queued for them.
async fn run_queued(name: &str, args: &str, ctx: &Ctx) -> R<()> {
    let args: Value = serde_json::from_str(args).map_err(|_| "invalid-args".to_string())?;
    mutate(name, obj(&args)?, ctx).await
}

/// `mutate`: the change run at once and queued for the server, in one transaction; refused, nothing is written.
/// `args` is the arguments' JSON as the shell wrote it, kept as it is in the queue.
async fn queue(a: &Obj, ctx: &Ctx) -> R<Value> {
    let name = a.get("mutator").and_then(Value::as_str).ok_or("invalid-args")?;
    let args = a.get("args").and_then(Value::as_str).ok_or("invalid-args")?;
    let id = int_of(&first(sql("SELECT next_mutation_id FROM _sync_meta", vec![]).await).ok_or("not-open")?[0]);
    sql("UPDATE _sync_meta SET next_mutation_id = ?", vec![json!(id + 1)]).await;
    sql("INSERT INTO _mutation (id, name, v, args) VALUES (?, ?, ?, ?)", vec![json!(id), json!(name), json!(MUTATOR_VERSION), json!(args)]).await;
    run_queued(name, args, ctx).await?;
    Ok(json!({ "tables": changed_tables().await }))
}

/// The queue, oldest first: what a push sends, each mutation's arguments as their JSON text.
async fn pending() -> Value {
    let rows = sql("SELECT id, name, v, args FROM _mutation ORDER BY id", vec![]).await;
    Value::Array(rows.into_iter().map(|r| json!({ "id": r[0], "name": r[1], "v": r[2], "args": r[3] })).collect())
}

/// Puts in a row to one table, gathered into one statement.
struct Run { table: &'static str, columns: &'static [&'static str], params: Vec<Value>, rows: usize }

async fn flush(run: &mut Option<Run>) {
    if let Some(r) = run.take() { sql(&upsert(r.table, r.columns, r.rows), r.params).await; }
}

/// Every optimistic write undone, the server's pages applied, what the server has consumed dropped, and the rest of
/// the queue replayed on top, each in a savepoint: one that no longer applies here stays queued, the server decides.
async fn rebase(a: &Obj, ctx: &Ctx) -> R<Value> {
    let pages = match a.get("pages") { Some(Value::Array(p)) if !p.is_empty() => p, _ => return Err("invalid-args".into()) };
    sql("PRAGMA defer_foreign_keys = ON", vec![]).await;
    sql("UPDATE _sync_meta SET capture = 0", vec![]).await;
    for s in undo_restore() { sql(&s, vec![]).await; }
    sql("DELETE FROM _undo", vec![]).await;

    if pages[0]["clear"].as_bool() == Some(true) {
        for (table, _) in TABLES.iter().rev() { sql(&format!("DELETE FROM {table}"), vec![]).await; }
    }
    let mut run: Option<Run> = None;
    let mut results: Vec<Value> = Vec::new();
    for page in pages {
        for op in page["patch"].as_array().map(Vec::as_slice).unwrap_or_default() {
            let Some(table) = op["tbl"].as_str().and_then(|t| TABLES.iter().find(|(n, _)| *n == t).map(|(n, _)| *n)) else { continue };
            let cols = columns(table).unwrap();
            if op["op"].as_str() == Some("del") {
                flush(&mut run).await;
                sql(&format!("DELETE FROM {table} WHERE id = ?"), vec![op["pk"].clone()]).await;
                continue;
            }
            if run.as_ref().is_some_and(|r| r.table != table || (r.rows + 1) * cols.len() > MAX_PARAMS) { flush(&mut run).await; }
            let r = run.get_or_insert_with(|| Run { table, columns: cols, params: vec![], rows: 0 });
            r.params.extend(cols.iter().map(|c| op["row"].get(*c).cloned().unwrap_or(Value::Null)));
            r.rows += 1;
        }
        results.extend(page["results"].as_array().cloned().unwrap_or_default());
    }
    flush(&mut run).await;

    let last = pages.last().unwrap();
    sql("DELETE FROM _mutation WHERE id <= ?", vec![last["lastMutationId"].clone()]).await;
    sql("UPDATE _sync_meta SET cookie = ?, last_mutation_id = ?, capture = 1", vec![last["cookie"].clone(), last["lastMutationId"].clone()]).await;

    let mut refused = 0;
    for m in sql("SELECT id, name, v, args FROM _mutation ORDER BY id", vec![]).await {
        sql("SAVEPOINT replay", vec![]).await;
        let done = run_queued(&s(&m[1]), &s(&m[3]), ctx).await;
        // A statement the shell could not run fails the replay as a refusal does; the statements after it run again.
        let failed = take_failure().is_some();
        if done.is_err() || failed {
            sql("ROLLBACK TO replay", vec![]).await;
            refused += 1;
        }
        sql("RELEASE replay", vec![]).await;
    }
    let changed = pages.iter().any(|p| p["clear"].as_bool() == Some(true) || p["patch"].as_array().is_some_and(|x| !x.is_empty()) || p["results"].as_array().is_some_and(|x| !x.is_empty()));
    Ok(json!({ "tables": changed_tables().await, "results": results, "changed": changed, "replaysRefused": refused }))
}
