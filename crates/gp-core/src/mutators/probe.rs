// packages/core/src/mutators/probe.ts: a test helper that writes, reads, writes again, and always refuses, so the sync
// tests prove a mutator's earlier writes are rolled back on every database.
use super::*;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "probeWriteThenThrow" => probe(a, ctx).await,
        _ => return None,
    })
}

async fn probe(a: &Obj, ctx: &Ctx) -> R<()> {
    let song = id(a, "songId")?;
    require(ctx, "ManageSongs")?;
    sql("INSERT INTO songs (id, name) VALUES (?, 'should never be seen')", vec![json!(song)]).await;
    sql("SELECT * FROM songs WHERE id = ?", vec![json!(song)]).await;
    sql("UPDATE songs SET name = 'still never seen' WHERE id = ?", vec![json!(song)]).await;
    Err("probe-failure".into())
}
