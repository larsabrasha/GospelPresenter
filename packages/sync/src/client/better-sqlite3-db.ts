import Database from 'better-sqlite3';
import type { ClientSqlite } from './sqlite.ts';

/** better-sqlite3 behind the async ClientSqlite interface (Electron's main process). */
export function openBetterSqlite(file = ':memory:'): ClientSqlite {
  const db = new Database(file);
  return {
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (!stmt.reader) {
        stmt.run(...params);
        return { columns: [], rows: [] };
      }
      stmt.raw(true);
      return { columns: stmt.columns().map((c) => c.name), rows: stmt.all(...params) as unknown[][] };
    },
    async close() {
      db.close();
    },
  };
}
