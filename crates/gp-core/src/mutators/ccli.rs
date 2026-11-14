// packages/core/src/mutators/ccli.ts: the CCLI report, its songs shown live and the entries marked reported.
use super::*;
use super::themes::set_setting;
use crate::json::string_list;

const CCLI_COLLECTION_SETTING: &str = "ccliCollection";

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "setCcliCollection" => set_ccli_collection(a, ctx).await,
        "recordCcliUse" => record_ccli_use(a, ctx).await,
        "setCcliReported" => set_ccli_reported(a, ctx).await,
        _ => return None,
    })
}

async fn set_ccli_collection(a: &Obj, ctx: &Ctx) -> R<()> {
    let on = boolean(a, "on")?;
    require(ctx, "ManageOrganizationSettings")?;
    set_setting(CCLI_COLLECTION_SETTING, if on { "true" } else { "false" }).await;
    Ok(())
}

/// At most `max` characters, as it is.
fn text_max(o: &Obj, k: &str, max: usize) -> R<String> {
    match o.get(k) { Some(Value::String(t)) if t.chars().count() <= max => Ok(t.clone()), _ => Err("invalid-args".into()) }
}

/// A song shown live for 10 s: recorded only while collection is on, once per song, day and presentation.
async fn record_ccli_use(a: &Obj, ctx: &Ctx) -> R<()> {
    let (song_id, song_name, ccli) = (id(a, "songId")?, text_max(a, "songName", 200)?, trimmed(a, "ccli", 0, 20)?);
    let (pid, pname) = (id(a, "presentationId")?, text_max(a, "presentationName", 200)?);
    let date = match a.get("date") {
        Some(Value::String(d)) if d.len() == 10 && d.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() }) => d.clone(),
        _ => return Err("invalid-args".into()),
    };
    require(ctx, "ManagePresentations")?;
    if ccli.is_empty() { return Ok(()) }
    let on = first(sql("SELECT value FROM org_settings WHERE id = ?", vec![json!(CCLI_COLLECTION_SETTING)]).await).is_some_and(|s| s[0].as_str() == Some("true"));
    if !on { return Ok(()) }
    sql("INSERT INTO ccli_entries (id, song_id, song_name, ccli, presentation_id, presentation_name, date, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT DO NOTHING",
        vec![json!(format!("{song_id}|{date}|{pid}")), json!(song_id), json!(song_name), json!(ccli), json!(pid), json!(pname), json!(date)]).await;
    Ok(())
}

/// A card's "Rapporterad": its entries reported at `at`, or not reported.
async fn set_ccli_reported(a: &Obj, ctx: &Ctx) -> R<()> {
    let entries: Vec<String> = match a.get("ids") {
        Some(Value::Array(xs)) if (1..=500).contains(&xs.len()) => xs.iter().map(|x| match x {
            Value::String(s) if (1..=400).contains(&s.chars().count()) => Ok(s.clone()),
            _ => Err("invalid-args".to_string()),
        }).collect::<R<_>>()?,
        _ => return Err("invalid-args".into()),
    };
    let (reported, at) = (boolean(a, "reported")?, safe_int(a, "at")?);
    require(ctx, "ManageCcliReport")?;
    // The ids as one JSON value: a Durable Object binds at most 100 values a statement.
    sql("UPDATE ccli_entries SET reported_at = ? WHERE id IN (SELECT value FROM json_each(?))",
        vec![if reported { json!(at) } else { Value::Null }, json!(string_list(&entries))]).await;
    Ok(())
}
