// packages/core/src/mutators/bibles-and-themes.ts: Bible translations, imported, renamed and deleted.
use super::*;

const BIBLES: i64 = 10;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "importBible" => import(a, ctx).await,
        "renameBible" => rename(a, ctx).await,
        "deleteBible" => delete(a, ctx).await,
        _ => return None,
    })
}

/// `bibleId`: the abbreviation, NFC, trimmed and lower-cased, so two imports of it converge.
fn bible_id(abbreviation: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let nfc: String = abbreviation.nfc().collect();
    format!("bible:{}", js_trim(&nfc).to_lowercase())
}

/// Drops a stored text that no translation names any more.
async fn drop_unused_text(hash: &str) {
    if found("SELECT id FROM bibles WHERE content_hash = ?", vec![json!(hash)]).await { return }
    sql("DELETE FROM bible_blobs WHERE hash = ?", vec![json!(hash)]).await;
    sql("DELETE FROM bible_texts WHERE hash = ?", vec![json!(hash)]).await;
}

/// `language`: trimmed, at most 20, or null; it must be given.
fn language(o: &Obj) -> R<Option<String>> {
    match o.get("language") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(l)) if js_trim(l).chars().count() <= 20 => Ok(Some(js_trim(l).to_string())),
        _ => Err("invalid-args".into()),
    }
}

/// A translation, or the one with the same abbreviation replaced; its text must be stored here already.
async fn import(a: &Obj, ctx: &Ctx) -> R<()> {
    let (name, abbreviation, language, hash) = (trimmed(a, "name", 1, 200)?, trimmed(a, "abbreviation", 1, 50)?, language(a)?, media_hash(a, "contentHash")?);
    require(ctx, "ManageBibles")?;
    let text = first(sql("SELECT verse_count FROM bible_blobs WHERE hash = ?", vec![json!(hash)]).await).ok_or("bible-text-missing")?;
    let bid = bible_id(&abbreviation);
    let existing = first(sql("SELECT content_hash FROM bibles WHERE id = ?", vec![json!(bid)]).await);
    if existing.is_none() {
        limit(int_of(&first(sql("SELECT count(*) FROM bibles", vec![]).await).unwrap()[0]) >= BIBLES)?;
    }
    let row = vec![json!(name), json!(abbreviation), json!(language), text[0].clone(), json!(hash)];
    match &existing {
        Some(_) => sql("UPDATE bibles SET name = ?, abbreviation = ?, language = ?, verse_count = ?, content_hash = ? WHERE id = ?", [row, vec![json!(bid)]].concat()).await,
        None => sql("INSERT INTO bibles (id, name, abbreviation, language, verse_count, content_hash) VALUES (?, ?, ?, ?, ?, ?)", [vec![json!(bid)], row].concat()).await,
    };
    if let Some(old) = existing.filter(|e| e[0].as_str() != Some(hash.as_str())) { drop_unused_text(&s(&old[0])).await }
    Ok(())
}

async fn rename(a: &Obj, ctx: &Ctx) -> R<()> {
    let (bid, name) = (id(a, "id")?, trimmed(a, "name", 1, 200)?);
    require(ctx, "ManageBibles")?;
    sql("UPDATE bibles SET name = ? WHERE id = ?", vec![json!(name), json!(bid)]).await;
    Ok(())
}

/// No trash; items made from it keep their text.
async fn delete(a: &Obj, ctx: &Ctx) -> R<()> {
    let bid = id(a, "id")?;
    require(ctx, "ManageBibles")?;
    let Some(b) = first(sql("SELECT content_hash FROM bibles WHERE id = ?", vec![json!(bid)]).await) else { return Ok(()) };
    sql("DELETE FROM bibles WHERE id = ?", vec![json!(bid)]).await;
    drop_unused_text(&s(&b[0])).await;
    Ok(())
}
