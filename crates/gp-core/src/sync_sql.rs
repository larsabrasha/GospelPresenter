// packages/core/src/sync-sql.ts's client half: the synced tables and their columns (`tableInfo`, Drizzle's order), the
// client's sync tables, the triggers that keep the first pre-image of every row a local change touches (`_undo`), the
// statements that put them back, the upsert a pull applies, and the temp record of the tables a transaction wrote.

/// Every synced table and its columns, in schema.ts's order: the order every statement below names them in.
pub const TABLES: [(&str, &[&str]); 18] = [
    ("labels", &["id", "text", "color", "sort"]),
    ("songs", &["id", "name", "author", "publisher", "year", "ccli", "deleted_at"]),
    ("song_parts", &["id", "song_id", "sort", "label_id", "content"]),
    ("song_arrangements", &["id", "song_id", "name", "part_ids", "sort"]),
    ("song_versions", &["id", "song_id", "user_id", "created_at", "name", "data"]),
    ("song_materials", &["id", "song_id", "kind", "title", "url", "hash", "content_type", "size", "sort", "created_at"]),
    ("ccli_entries", &["id", "song_id", "song_name", "ccli", "presentation_id", "presentation_name", "date", "reported_at"]),
    ("presentations", &["id", "name", "event_date", "deleted_at", "theme_id", "is_template", "weekday", "time", "location", "last_used_at", "description", "updated_at"]),
    ("presentation_items", &["id", "presentation_id", "type", "title", "source_id", "sort", "arrangement_id", "content", "overlay_id", "note"]),
    ("bibles", &["id", "name", "abbreviation", "language", "verse_count", "content_hash"]),
    ("org_settings", &["id", "value"]),
    ("images", &["id", "file_name", "content_type", "full_hash", "thumb_hash", "width", "height", "created_at", "deleted_at", "original_full_hash",
        "original_thumb_hash", "original_width", "original_height", "edit"]),
    ("displays", &["id", "name", "code", "kind", "created_at"]),
    ("audios", &["id", "file_name", "content_type", "hash", "size", "created_at", "deleted_at"]),
    ("overlays", &["id", "title", "content", "image_id", "sort", "updated_at"]),
    ("videos", &["id", "file_name", "content_type", "codec", "hash", "size", "duration", "width", "height", "still_hash", "thumb_hash", "created_at", "deleted_at"]),
    ("custom_slides", &["id", "name", "pages", "created_at", "updated_at", "deleted_at"]),
    ("themes", &["id", "name", "definition", "sort", "updated_at"]),
];

/// The tables of the device's own whose changes a page hears of too (`watchedTables` beyond the synced ones).
const LOCAL_WATCHED: [&str; 6] = ["bible_texts", "bible_blobs", "media_blobs", "pinned_presentations", "kept_bibles", "video_files"];

/// A synced table's columns, by its name.
pub fn columns(table: &str) -> Option<&'static [&'static str]> { TABLES.iter().find(|(t, _)| *t == table).map(|(_, c)| *c) }

/// `clientSyncDdl`.
pub const CLIENT_SYNC_DDL: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS _sync_meta (
     one INTEGER PRIMARY KEY CHECK (one = 1),
     client_id TEXT NOT NULL, cookie TEXT, last_mutation_id INTEGER NOT NULL DEFAULT 0,
     next_mutation_id INTEGER NOT NULL DEFAULT 1, capture INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS _mutation (
     id INTEGER PRIMARY KEY, name TEXT NOT NULL, v INTEGER NOT NULL, args TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS _undo (
     tbl TEXT NOT NULL, pk TEXT NOT NULL, before TEXT, PRIMARY KEY (tbl, pk))",
];

/// `clientUndoTriggers`: while capture is on, the first pre-image of every row touched (NULL for a row that was not
/// there). Dropped and made again on every open, as they name every column.
pub fn undo_triggers() -> Vec<String> {
    let on = "WHEN (SELECT capture FROM _sync_meta) = 1";
    let keep_first = |name: &str, pk: &str, image: &str| {
        format!("INSERT INTO _undo (tbl, pk, before) SELECT '{name}', {pk}, {image}\n         WHERE NOT EXISTS (SELECT 1 FROM _undo WHERE tbl = '{name}' AND pk = {pk});")
    };
    TABLES.iter().flat_map(|(name, columns)| {
        let image = format!("json_object({})", columns.iter().map(|c| format!("'{c}', OLD.{c}")).collect::<Vec<_>>().join(", "));
        let mut t: Vec<String> = ["ins", "upd", "del"].iter().map(|op| format!("DROP TRIGGER IF EXISTS undo_{name}_{op}")).collect();
        t.push(format!("CREATE TRIGGER undo_{name}_ins AFTER INSERT ON {name} {on} BEGIN\n         {} END", keep_first(name, "NEW.id", "NULL")));
        t.push(format!("CREATE TRIGGER undo_{name}_upd BEFORE UPDATE ON {name} {on} BEGIN\n         {} END", keep_first(name, "OLD.id", &image)));
        t.push(format!("CREATE TRIGGER undo_{name}_del BEFORE DELETE ON {name} {on} BEGIN\n         {} END", keep_first(name, "OLD.id", &image)));
        t
    }).collect()
}

/// `clientUndoRestore`: every captured row put back to its pre-image (run with capture off).
pub fn undo_restore() -> Vec<String> {
    TABLES.iter().flat_map(|(name, columns)| {
        let extract = columns.iter().map(|c| format!("json_extract(before, '$.{c}')")).collect::<Vec<_>>().join(", ");
        let set = columns.iter().map(|c| format!("{c} = excluded.{c}")).collect::<Vec<_>>().join(", ");
        [
            format!("DELETE FROM {name} WHERE id IN (SELECT pk FROM _undo WHERE tbl = '{name}' AND before IS NULL)"),
            format!("INSERT INTO {name} ({})\n       SELECT {extract}\n       FROM _undo WHERE tbl = '{name}' AND before IS NOT NULL AND true\n       ON CONFLICT (id) DO UPDATE SET {set}", columns.join(", ")),
        ]
    }).collect()
}

/// `upsertSql`: `rows` rows of `table` by their column values, a later row of the same id winning.
pub fn upsert(table: &str, columns: &[&str], rows: usize) -> String {
    let values = format!("({})", vec!["?"; columns.len()].join(", "));
    let set = columns.iter().map(|c| format!("{c} = excluded.{c}")).collect::<Vec<_>>().join(", ");
    format!("INSERT INTO {table} ({}) VALUES {}\n    ON CONFLICT (id) DO UPDATE SET {set}", columns.join(", "), vec![values; rows].join(", "))
}

/// Where a connection notes the tables a transaction wrote, until it commits (`CHANGED_TABLES`).
pub const CHANGED_TABLES: &str = "temp.changed_tables";

/// `changeTrackingDdl`: a connection's own record of the tables the open transaction wrote. TEMP, made on every open.
pub fn change_tracking_ddl() -> Vec<String> {
    let watched = TABLES.iter().map(|(t, _)| *t).chain(LOCAL_WATCHED);
    let mut ddl = vec!["CREATE TEMP TABLE IF NOT EXISTS changed_tables (tbl TEXT PRIMARY KEY NOT NULL)".to_string()];
    for name in watched {
        for op in ["INSERT", "UPDATE", "DELETE"] {
            ddl.push(format!(
                "CREATE TEMP TRIGGER IF NOT EXISTS changed_{name}_{} AFTER {op} ON main.{name} BEGIN\n           INSERT INTO changed_tables (tbl) SELECT '{name}' WHERE NOT EXISTS (SELECT 1 FROM changed_tables WHERE tbl = '{name}'); END",
                op.to_lowercase()
            ));
        }
    }
    ddl
}
