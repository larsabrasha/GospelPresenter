// packages/core/src/org-schema.ts: an organisation's database as SQL, its version, and the migrations that bring an
// older one up to date, run by the core at open through the shell's SQL; and labels.ts's default labels.
use crate::args::R;
use crate::bridge::sql;
use serde_json::Value;

/// Bumped whenever a synced table changes shape.
pub const SCHEMA_VERSION: i64 = 26;
/// The first version `org_ddl` makes; a database from before it is refused.
pub const SCHEMA_BASELINE: i64 = 11;

const ORG_INDEXES: [&str; 4] = [
    "CREATE INDEX IF NOT EXISTS presentation_items_by_presentation ON presentation_items (presentation_id, sort)",
    "CREATE INDEX IF NOT EXISTS presentation_items_by_source ON presentation_items (source_id)",
    "CREATE INDEX IF NOT EXISTS song_parts_by_song ON song_parts (song_id, sort)",
    "CREATE INDEX IF NOT EXISTS song_arrangements_by_song ON song_arrangements (song_id, sort)",
];

const SONG_VERSIONS_DDL: [&str; 2] = [
    r#"CREATE TABLE IF NOT EXISTS song_versions (id TEXT PRIMARY KEY NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id),
     user_id TEXT NOT NULL, created_at INTEGER NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL)"#,
    "CREATE INDEX IF NOT EXISTS song_versions_by_song ON song_versions (song_id, created_at)",
];

const SONG_MATERIALS_DDL: [&str; 2] = [
    r#"CREATE TABLE IF NOT EXISTS song_materials (id TEXT PRIMARY KEY NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id),
     kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT, hash TEXT, content_type TEXT, size INTEGER, sort INTEGER NOT NULL,
     created_at INTEGER NOT NULL)"#,
    "CREATE INDEX IF NOT EXISTS song_materials_by_song ON song_materials (song_id, sort)",
];

const CCLI_ENTRIES_DDL: &str = r#"CREATE TABLE IF NOT EXISTS ccli_entries (id TEXT PRIMARY KEY NOT NULL, song_id TEXT NOT NULL, song_name TEXT NOT NULL,
     ccli TEXT NOT NULL, presentation_id TEXT NOT NULL, presentation_name TEXT NOT NULL, date TEXT NOT NULL, reported_at INTEGER)"#;

const CUSTOM_SLIDES_DDL: &str = r#"CREATE TABLE IF NOT EXISTS custom_slides (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, pages TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)"#;

const SLIDE_DECKS_DDL: &str = r#"CREATE TABLE IF NOT EXISTS slide_decks (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, pages TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)"#;

const VIDEOS_DDL: &str = r#"CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
     codec TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, duration INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     still_hash TEXT NOT NULL, thumb_hash TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER)"#;

const THEMES_DDL: &str = r#"CREATE TABLE IF NOT EXISTS themes (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL,
     sort INTEGER NOT NULL, updated_at INTEGER NOT NULL)"#;

const VIDEO_FILES_DDL: &str = r#"CREATE TABLE IF NOT EXISTS video_files (hash TEXT PRIMARY KEY NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL,
     used_at INTEGER NOT NULL)"#;

/// The DDL of the current version, as `orgDdl`.
fn org_ddl() -> Vec<String> {
    let mut d: Vec<&str> = vec![
        r#"CREATE TABLE IF NOT EXISTS labels (id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, color TEXT NOT NULL,
     sort INTEGER NOT NULL)"#,
        r#"CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, author TEXT,
     publisher TEXT, year INTEGER, ccli TEXT, deleted_at INTEGER)"#,
        r#"CREATE TABLE IF NOT EXISTS song_parts (id TEXT PRIMARY KEY NOT NULL,
     song_id TEXT NOT NULL REFERENCES songs(id), sort INTEGER NOT NULL,
     label_id TEXT REFERENCES labels(id), content TEXT NOT NULL)"#,
        r#"CREATE TABLE IF NOT EXISTS song_arrangements (id TEXT PRIMARY KEY NOT NULL,
     song_id TEXT NOT NULL REFERENCES songs(id), name TEXT, part_ids TEXT NOT NULL, sort INTEGER NOT NULL)"#,
    ];
    d.extend(SONG_VERSIONS_DDL);
    d.extend(SONG_MATERIALS_DDL);
    d.push(CCLI_ENTRIES_DDL);
    d.extend([
        r#"CREATE TABLE IF NOT EXISTS presentations (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, event_date TEXT,
     deleted_at INTEGER, theme_id TEXT, is_template INTEGER NOT NULL DEFAULT 0, weekday INTEGER, time TEXT,
     location TEXT, last_used_at INTEGER, description TEXT, updated_at INTEGER)"#,
        r#"CREATE TABLE IF NOT EXISTS presentation_items (id TEXT PRIMARY KEY NOT NULL,
     presentation_id TEXT NOT NULL REFERENCES presentations(id), type TEXT NOT NULL, title TEXT NOT NULL,
     source_id TEXT NOT NULL, sort INTEGER NOT NULL, arrangement_id TEXT, content TEXT, overlay_id TEXT, note TEXT)"#,
        r#"CREATE TABLE IF NOT EXISTS bibles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, abbreviation TEXT NOT NULL,
     language TEXT, verse_count INTEGER NOT NULL, content_hash TEXT NOT NULL)"#,
        "CREATE TABLE IF NOT EXISTS org_settings (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
        r#"CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
     full_hash TEXT NOT NULL, thumb_hash TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
     created_at INTEGER NOT NULL, deleted_at INTEGER, original_full_hash TEXT, original_thumb_hash TEXT,
     original_width INTEGER, original_height INTEGER, edit TEXT)"#,
        "CREATE TABLE IF NOT EXISTS displays (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER)",
        r#"CREATE TABLE IF NOT EXISTS audios (id TEXT PRIMARY KEY NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL,
     hash TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER)"#,
        r#"CREATE TABLE IF NOT EXISTS overlays (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, content TEXT, image_id TEXT,
     sort INTEGER NOT NULL, updated_at INTEGER)"#,
        VIDEOS_DDL,
        // Not synced: what this database keeps for itself.
        r#"CREATE TABLE IF NOT EXISTS bible_texts (hash TEXT NOT NULL, book TEXT NOT NULL, sort INTEGER NOT NULL, chunk TEXT NOT NULL,
     PRIMARY KEY (hash, book))"#,
        "CREATE TABLE IF NOT EXISTS bible_blobs (hash TEXT PRIMARY KEY NOT NULL, verse_count INTEGER NOT NULL)",
        r#"CREATE TABLE IF NOT EXISTS media_blobs (hash TEXT PRIMARY KEY NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
     bytes BLOB, received_at INTEGER NOT NULL)"#,
        "CREATE TABLE IF NOT EXISTS pinned_presentations (id TEXT PRIMARY KEY NOT NULL, pinned_at INTEGER NOT NULL)",
        "CREATE TABLE IF NOT EXISTS kept_bibles (id TEXT PRIMARY KEY NOT NULL, kept_at INTEGER NOT NULL)",
        VIDEO_FILES_DDL,
        CUSTOM_SLIDES_DDL,
        THEMES_DDL,
    ]);
    d.extend(ORG_INDEXES);
    d.into_iter().map(String::from).collect()
}

/// A picture of Bilder named by `id` (an SQL expression) as a page's own: its blobs as JSON, null where it is gone.
fn picture_of(id: &str) -> String {
    format!("json((SELECT json_object('full', i.full_hash, 'thumb', i.thumb_hash) FROM images i WHERE i.id = {id}))")
}

/// `page`'s pictures of Bilder made its own blobs (schema 22), as `ownPicturesSql`.
fn own_pictures_sql(page: &str) -> String {
    let background = picture_of(&format!("json_extract({page}, '$.backgroundImageId')"));
    let element = picture_of("json_extract(e.value, '$.imageId')");
    format!(
        r#"json_set(json_remove({page}, '$.backgroundImageId'),
      '$.backgroundPicture', {background},
      '$.backgroundPage', json(json_extract({page}, '$.backgroundPage')),
      '$.elements', json((SELECT json_group_array(json(CASE WHEN json_extract(e.value, '$.kind') = 'image' AND json_extract(e.value, '$.imageId') IS NOT NULL
          THEN json_set(json_remove(e.value, '$.imageId'), '$.picture', {element})
          ELSE e.value END))
        FROM json_each({page}, '$.elements') e
        WHERE json_extract(e.value, '$.kind') <> 'image' OR json_extract(e.value, '$.imageId') IS NULL
          OR EXISTS (SELECT 1 FROM images i WHERE i.id = json_extract(e.value, '$.imageId')))))"#
    )
}

/// A song part 1.x left with only an empty ProPresenter slide's RTF header (`rtfLeftoverSql`).
fn rtf_leftover_sql(content: &str) -> String {
    format!(r#"(instr({content}, ';') > 0 AND trim({content}, ' ;\*' || char(9, 10, 13)) = '')"#)
}

/// The statements that take a database from version `v - 1` to `v` (`orgMigrations`).
fn migration(v: i64) -> Vec<String> {
    let owned = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match v {
        12 => {
            let mut m = owned(&["ALTER TABLE presentations ADD COLUMN description TEXT", "ALTER TABLE presentations ADD COLUMN updated_at INTEGER", "ALTER TABLE displays ADD COLUMN created_at INTEGER"]);
            m.extend(owned(&ORG_INDEXES));
            m
        }
        13 => owned(&[VIDEOS_DDL]),
        14 => owned(&[VIDEO_FILES_DDL]),
        15 => owned(&SONG_VERSIONS_DDL),
        16 => owned(&[CCLI_ENTRIES_DDL]),
        17 => owned(&SONG_MATERIALS_DDL),
        18 => owned(&[CUSTOM_SLIDES_DDL]),
        19 => owned(&["DELETE FROM overlays", "UPDATE presentation_items SET overlay_id = NULL WHERE overlay_id IS NOT NULL", "ALTER TABLE overlays ADD COLUMN updated_at INTEGER"]),
        20 => owned(&[
            SLIDE_DECKS_DDL,
            r#"INSERT OR IGNORE INTO slide_decks (id, name, pages, created_at, updated_at, deleted_at)
       SELECT id, title, json_extract(content, '$.pages'), 0, 0, NULL FROM presentation_items
       WHERE type = 'slides' AND (CASE WHEN json_valid(content) THEN json_array_length(content, '$.pages') ELSE 0 END) > 0"#,
            "UPDATE presentation_items SET source_id = id, content = NULL WHERE type = 'slides'",
        ]),
        21 => owned(&[
            r#"INSERT OR IGNORE INTO custom_slides (id, name, pages, created_at, updated_at, deleted_at)
       SELECT d.id, d.name,
         (SELECT json_group_array(json_object('background', '#000000', 'backgroundImageId', NULL,
            'backgroundPage', json_object('full', json_extract(j.value, '$.full'), 'thumb', json_extract(j.value, '$.thumb')),
            'elements', json('[]'))) FROM json_each(d.pages) j),
         d.created_at, d.updated_at, d.deleted_at
       FROM slide_decks d"#,
            "UPDATE presentation_items SET type = 'custom' WHERE type = 'slides'",
            "DROP TABLE slide_decks",
        ]),
        22 => vec![
            format!("UPDATE custom_slides SET pages = (SELECT json_group_array(json({})) FROM json_each(custom_slides.pages) pg) WHERE json_valid(pages)", own_pictures_sql("pg.value")),
            format!("UPDATE overlays SET content = {} WHERE json_valid(content)", own_pictures_sql("content")),
        ],
        23 => owned(&[THEMES_DDL]),
        24 => owned(&["ALTER TABLE presentation_items ADD COLUMN note TEXT"]),
        25 => ["original_full_hash TEXT", "original_thumb_hash TEXT", "original_width INTEGER", "original_height INTEGER", "edit TEXT"]
            .iter().map(|c| format!("ALTER TABLE images ADD COLUMN {c}")).collect(),
        26 => vec![
            format!(
                r#"UPDATE song_arrangements SET part_ids = (SELECT json_group_array(j.value) FROM json_each(song_arrangements.part_ids) j
       WHERE j.value NOT IN (SELECT p.id FROM song_parts p WHERE {}))
     WHERE json_valid(part_ids) AND EXISTS (SELECT 1 FROM json_each(song_arrangements.part_ids) j
       JOIN song_parts p ON p.id = j.value WHERE {})"#,
                rtf_leftover_sql("p.content"), rtf_leftover_sql("p.content")
            ),
            format!("DELETE FROM song_parts WHERE {}", rtf_leftover_sql("content")),
        ],
        _ => vec![],
    }
}

const SCHEMA_META_DDL: &str = "CREATE TABLE IF NOT EXISTS _schema (one INTEGER PRIMARY KEY CHECK (one = 1), version INTEGER NOT NULL)";

fn version_row() -> String { format!("INSERT OR REPLACE INTO _schema (one, version) VALUES (1, {SCHEMA_VERSION})") }

/// What to run to bring a database to SCHEMA_VERSION (`orgSchemaPlan`); a refusal for one from before the
/// baseline (`schema-too-old`) or newer than this core (`schema-too-new`).
fn plan(version: Option<i64>, has_tables: bool) -> R<Vec<String>> {
    match version {
        None if !has_tables => Ok(org_ddl().into_iter().chain([version_row()]).collect()),
        None => Err("schema-too-old".into()),
        Some(v) if v < SCHEMA_BASELINE => Err("schema-too-old".into()),
        Some(v) if v > SCHEMA_VERSION => Err("schema-too-new".into()),
        Some(v) if v == SCHEMA_VERSION => Ok(vec![]),
        Some(v) => Ok(((v + 1)..=SCHEMA_VERSION).flat_map(migration).chain([version_row()]).collect()),
    }
}

/// `migrateOrgSchema`, in the shell's one transaction: a refused database is left exactly as it was.
pub async fn migrate() -> R<Value> {
    sql(SCHEMA_META_DDL, vec![]).await;
    let version = sql("SELECT version FROM _schema WHERE one = 1", vec![]).await.into_iter().next().map(|r| crate::mutators::int_of(&r[0]));
    let tables = sql("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'songs'", vec![]).await;
    let has_tables = tables.first().map_or(0, |r| crate::mutators::int_of(&r[0])) > 0;
    for s in plan(version, has_tables)? {
        sql(&s, vec![]).await;
    }
    Ok(Value::Null)
}

const DEFAULT_LABELS: [(&str, &str); 25] = [
    ("Verse", "#3478c7"), ("Verse 1", "#2e6ab8"), ("Verse 2", "#285da9"), ("Verse 3", "#22509a"), ("Verse 4", "#1c438b"),
    ("Verse 5", "#16367c"), ("Verse 6", "#10296d"), ("Chorus", "#c73448"), ("Chorus 1", "#b82e40"), ("Chorus 2", "#972738"),
    ("Chorus 3", "#7a2030"), ("Chorus 4", "#6b1c2a"), ("Bridge", "#7834c7"), ("Bridge 1", "#6b2eb8"), ("Bridge 2", "#5e28a9"),
    ("Bridge 3", "#4e2096"), ("PreChorus", "#c734a8"), ("Tag", "#c73434"), ("Intro", "#c7b834"), ("Ending", "#b8ad2e"),
    ("Outro", "#a9a228"), ("Interlude", "#34c734"), ("Vamp", "#34b834"), ("Turnaround", "#34a934"), ("Blank", "#1a1a1a"),
];
pub const DEFAULT_LABEL_COLOR: &str = "#6b7280";

/// The colour and order a label made from `text` gets (`labelDefaults`).
pub fn label_defaults(text: &str) -> (&'static str, i64) {
    let key = crate::args::label_key(text);
    DEFAULT_LABELS.iter().enumerate().find(|(_, (t, _))| crate::args::label_key(t) == key)
        .map_or((DEFAULT_LABEL_COLOR, DEFAULT_LABELS.len() as i64), |(i, (_, c))| (c, i as i64))
}

/// `labelSeedSql`: the 25 default labels, written once by the server when it opens the database.
pub async fn seed_labels() -> R<Value> {
    sql("CREATE TABLE IF NOT EXISTS server_seeds (what TEXT PRIMARY KEY NOT NULL)", vec![]).await;
    for (sort, (text, color)) in DEFAULT_LABELS.iter().enumerate() {
        let key = crate::args::label_key(text);
        let s = format!(
            "INSERT INTO labels (id, text, color, sort) SELECT 'label:{key}', '{text}', '{color}', {sort}
       WHERE NOT EXISTS (SELECT 1 FROM server_seeds WHERE what = 'labels')
         AND NOT EXISTS (SELECT 1 FROM labels WHERE id = 'label:{key}' OR lower(trim(text)) = '{key}')"
        );
        sql(&s, vec![]).await;
    }
    sql("INSERT INTO server_seeds (what) SELECT 'labels' WHERE NOT EXISTS (SELECT 1 FROM server_seeds WHERE what = 'labels')", vec![]).await;
    Ok(Value::Null)
}
