using GospelPresenter.Client.Data;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Raw-SQL primitives for the sync engine's bookkeeping tables. Raw rather than tracked EF writes:
/// they run mid-transaction next to trigger-guarded work, and upserts keep them idempotent.
/// </summary>
internal static class SyncSql
{
    public static Task SetStateAsync(ClientDataContext db, string key, string value, CancellationToken ct) =>
        db.Database.ExecuteSqlAsync(
            $"INSERT INTO SyncState (Key, Value) VALUES ({key}, {value}) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value", ct);

    public static async Task<string?> GetStateAsync(ClientDataContext db, string key, CancellationToken ct) =>
        (await db.SyncState.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key, ct))?.Value;

    public static Task UpsertBaseAsync(ClientDataContext db, string table, string id, DateTimeOffset modifiedAt, CancellationToken ct) =>
        db.Database.ExecuteSqlAsync(
            $"INSERT INTO SyncBase (EntityTable, RowId, BaseModifiedAt) VALUES ({table}, {id}, {modifiedAt.ToUnixTimeMilliseconds()}) ON CONFLICT(EntityTable, RowId) DO UPDATE SET BaseModifiedAt = excluded.BaseModifiedAt", ct);

    public static Task RemoveBaseAsync(ClientDataContext db, string table, string id, CancellationToken ct) =>
        db.Database.ExecuteSqlAsync(
            $"DELETE FROM SyncBase WHERE EntityTable = {table} AND RowId = {id}", ct);
}
