// packages/core/src/mutators/trash.ts: what has been in the trash past the retention, or all of it, purged, of the
// kinds the caller manages.
use super::*;
use super::songs::delete_song_rows;

/// 30 days (trash.ts's TRASH_RETENTION_MS).
const RETENTION_MS: f64 = 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "purgeExpiredTrash" => purge_expired(a, ctx).await,
        "emptyTrash" => purge_until(MAX_SAFE, ctx).await,
        _ => return None,
    })
}

/// On the server the earlier of the client's clock and its own counts, so a client clock ahead never purges early.
async fn purge_expired(a: &Obj, ctx: &Ctx) -> R<()> {
    let now = safe_int(a, "now")? as f64;
    purge_until(now.min(ctx.now.unwrap_or(now)) - RETENTION_MS, ctx).await
}

/// A number bound as JavaScript would: an integer when it is one.
fn number(f: f64) -> Value { if f.fract() == 0.0 && f.abs() <= MAX_SAFE { json!(f as i64) } else { json!(f) } }

/// Purges what went to the trash at or before `cutoff`, of the kinds the caller manages.
async fn purge_until(cutoff: f64, ctx: &Ctx) -> R<()> {
    let at = number(cutoff);
    let expired = "deleted_at IS NOT NULL AND deleted_at <= ?";
    if can(&ctx.role, "ManageSongs") {
        for song in ids_of(&format!("SELECT id FROM songs WHERE {expired}"), vec![at.clone()]).await { delete_song_rows(&song).await }
    }
    for (template, permission) in [(0, "ManagePresentations"), (1, "ManageTemplates")] {
        if !can(&ctx.role, permission) { continue }
        let which = format!("is_template = {template} AND {expired}");
        sql(&format!("DELETE FROM presentation_items WHERE presentation_id IN (SELECT id FROM presentations WHERE {which})"), vec![at.clone()]).await;
        sql(&format!("DELETE FROM presentations WHERE {which}"), vec![at.clone()]).await;
    }
    for (table, permission) in [("images", "ManageImages"), ("audios", "ManageAudios"), ("videos", "ManageVideos"), ("custom_slides", "ManagePresentations")] {
        if can(&ctx.role, permission) { sql(&format!("DELETE FROM {table} WHERE {expired}"), vec![at.clone()]).await; }
    }
    Ok(())
}
