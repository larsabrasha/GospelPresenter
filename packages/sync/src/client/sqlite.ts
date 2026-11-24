/**
 * The client's local SQLite behind one async interface: wa-sqlite (browser,
 * tests) or better-sqlite3 (Electron). Async because wa-sqlite on OPFS is.
 */
export interface ClientSqlite {
  query(sql: string, params?: unknown[]): Promise<{ columns: string[]; rows: unknown[][] }>;
  close(): Promise<void>;
}

/** Rows as objects, in column order. */
export async function queryObjects(db: ClientSqlite, sql: string, params: unknown[] = []) {
  const { columns, rows } = await db.query(sql, params);
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}
