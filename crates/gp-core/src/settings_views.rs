// The Bibles, the themes and the CCLI report (apps/web's Bibler, Teman, the theme editor, CCLI-rapport): the
// translations as rows, the organisation's own themes and its default, the CCLI entries and whether collection is on,
// as the web's reads gave them (queries.ts). The Bibles' texts themselves, megabytes each, are read by the shell from
// where it keeps them, as it reads a picture's bytes. An order by name in the page's language is the shell's.
use crate::args::*;
use crate::bridge::sql;
use crate::rows::{columns, map, K};
use serde_json::{json, Value};

const BIBLE: &[(&str, K)] = &[("id", K::Str), ("name", K::Str), ("abbreviation", K::Str), ("language", K::Opt), ("verseCount", K::Num),
    ("contentHash", K::Str), ("stored", K::Bool), ("kept", K::Bool)];

/// `biblesView`: the translations, whether this device has each one's text and keeps it, in the table's order
/// (`listBibles` before its sort by name).
pub async fn bibles() -> R<Value> {
    let q = "SELECT b.id, b.name, b.abbreviation, b.language, b.verse_count, b.content_hash,
             EXISTS (SELECT 1 FROM bible_blobs t WHERE t.hash = b.content_hash), EXISTS (SELECT 1 FROM kept_bibles k WHERE k.id = b.id) FROM bibles b";
    Ok(Value::Array(sql(q, vec![]).await.iter().map(|r| map(r, BIBLE)).collect()))
}

/// `ownThemesView`: the organisation's own themes in the order they were made (`ownThemes`).
pub async fn own_themes() -> R<Value> {
    Ok(Value::Array(sql("SELECT id, name, definition, sort FROM themes ORDER BY sort, id", vec![]).await.iter().map(|r| crate::themes::own_row(r)).collect()))
}

/// `ownThemeView` {id}: an own theme to edit and when it was last saved, null when there is none (`getOwnTheme`).
pub async fn own_theme(a: &Obj) -> R<Value> {
    let id = id(a, "id")?;
    Ok(sql("SELECT id, name, definition, sort, updated_at FROM themes WHERE id = ?", vec![json!(id)]).await.first().map_or(Value::Null, |r| {
        json!({ "theme": crate::themes::own_row(r), "updatedAt": map(&r[4..5], &[("n", K::Num)])["n"] })
    }))
}

/// `defaultThemeIdView`: the organisation's default theme's id, null when it has chosen none (`orgDefaultThemeId`).
pub async fn default_theme_id() -> R<Value> {
    Ok(sql("SELECT value FROM org_settings WHERE id = 'defaultThemeId'", vec![]).await.into_iter().next().map_or(Value::Null, |r| r[0].clone()))
}

const CCLI: &[(&str, K)] = &[("id", K::Str), ("songId", K::Str), ("songName", K::Str), ("ccli", K::Str), ("presentationId", K::Str),
    ("presentationName", K::Str), ("date", K::Str), ("reportedAt", K::Opt)];

/// `ccliReportView`: {entries newest day first, as rows the page orders by presentation and song name in its language
/// (SONG-R52), whether collection is on (SONG-R49: only "true" is)}.
pub async fn ccli_report() -> R<Value> {
    let entries: Vec<Value> = sql(&format!("SELECT {} FROM ccli_entries ORDER BY date DESC", columns(CCLI)), vec![]).await.iter().map(|r| map(r, CCLI)).collect();
    let on = sql("SELECT value FROM org_settings WHERE id = 'ccliCollection'", vec![]).await.first().is_some_and(|r| r[0] == "true");
    Ok(json!({ "entries": entries, "on": on }))
}
